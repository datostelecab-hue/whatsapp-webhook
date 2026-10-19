// ============================================================
// ENTORNO LOCAL · REFRESCAR — copia producción a la base de este PC
// ============================================================
// Uso (la dirección de producción va SOLO en la variable, nunca en un fichero):
//
//   DATABASE_URL_PRODUCCION='postgresql://…render.com/telecab' node scripts/entorno-local/refrescar.js
//
// Qué hace, en orden:
//   1. Levanta los dos contenedores (docker-compose.yml) si no lo están.
//   2. Saca una copia de producción con pg_dump, que SOLO LEE (y además va con
//      la sesión en solo lectura). Sin los DATOS del odómetro de Mapon, que es
//      la mitad de la base y aquí no hace falta (la tabla sí se crea, vacía).
//      Las descargas en bruto de la ingesta SÍ vienen: medio ERP apunta a ellas
//      con claves ajenas, y sin sus filas esas claves no se pueden crear.
//   3. Borra la base local y la rehace con esa copia. Lo que hubiera en local se
//      pierde: es la idea, partir siempre de lo que hay en producción.
//   4. La marca como copia local (tabla `entorno_local`): sin esa marca,
//      arrancar.js no arranca contra ella.
//   5. Le quita el correo de procesos: aunque el cortafuegos ya manda todo al
//      buzón falso, así la copia tampoco tiene con qué enviar por DonDominio.
//
// La copia tiene datos personales de verdad (DNI, email, teléfono). Se queda en
// el volumen de Docker de este PC; el fichero intermedio se borra al acabar.

const { spawnSync } = require('child_process');
const path = require('path');

const COMPOSE = path.join(__dirname, 'docker-compose.yml');
const PG = 'telecab-pg';
const SIN_DATOS = ['fv_odometro'];

function docker(args, { env, entrada, silencio } = {}) {
  const r = spawnSync('docker', args, {
    env: { ...process.env, ...(env || {}) },
    input: entrada, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`no puedo ejecutar docker (¿está Docker Desktop abierto?): ${r.error.message}`);
  if (!silencio && r.stderr && r.stderr.trim()) process.stderr.write(r.stderr);
  return r;
}
function obligatorio(r, que) {
  if (r.status !== 0) throw new Error(`${que} ha fallado (código ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(-800)}`);
  return r;
}
const psql = (sql, base = 'telecab') => obligatorio(
  docker(['exec', '-i', PG, 'psql', '-U', 'telecab', '-d', base, '-v', 'ON_ERROR_STOP=1', '-qAt'], { entrada: sql }),
  'psql');

(async () => {
  const t0 = Date.now();
  let prod = String(process.env.DATABASE_URL_PRODUCCION || '').trim();
  if (!/^postgres(ql)?:\/\//.test(prod)) {
    console.error('Falta DATABASE_URL_PRODUCCION (la dirección EXTERNA de la base de producción).');
    process.exit(1);
  }
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(prod)) {
    console.error('DATABASE_URL_PRODUCCION apunta a este PC: tiene que ser la de producción.');
    process.exit(1);
  }
  if (!/sslmode=/.test(prod)) prod += (prod.includes('?') ? '&' : '?') + 'sslmode=require';

  console.log('1/5 · Levantando los contenedores…');
  obligatorio(docker(['compose', '-f', COMPOSE, 'up', '-d', '--wait'], { silencio: true }), 'docker compose up');

  console.log('2/5 · Copiando producción (solo lectura; puede tardar unos minutos)…');
  // La dirección viaja como variable de entorno del contenedor (`-e PRODURL` sin
  // valor la toma de aquí): no aparece en ninguna línea de órdenes.
  const excluir = SIN_DATOS.map(t => `--exclude-table-data=${t}`).join(' ');
  obligatorio(docker(['exec', '-e', 'PRODURL', '-e', 'PGOPTIONS', PG, 'sh', '-c',
    `pg_dump "$PRODURL" -Fc --no-owner --no-acl ${excluir} -f /tmp/copia.dump && ls -l /tmp/copia.dump`],
  { env: { PRODURL: prod, PGOPTIONS: '-c default_transaction_read_only=on' } }), 'pg_dump');
  const tam = docker(['exec', PG, 'sh', '-c', 'du -h /tmp/copia.dump | cut -f1'], { silencio: true }).stdout.trim();
  console.log(`      copia de ${tam}`);

  console.log('3/5 · Rehaciendo la base local con la copia…');
  psql('DROP DATABASE IF EXISTS telecab WITH (FORCE);', 'postgres');
  psql('CREATE DATABASE telecab;', 'postgres');
  // pg_restore sigue aunque algo no entre (p. ej. un comentario de una extensión
  // que aquí no hace falta): se cuentan los avisos y se enseñan al final.
  const rest = docker(['exec', PG, 'pg_restore', '-U', 'telecab', '-d', 'telecab', '--no-owner', '--no-acl', '-j', '4', '/tmp/copia.dump'], { silencio: true });
  const avisos = (rest.stderr || '').split('\n').filter(l => /error|warning/i.test(l));
  docker(['exec', PG, 'rm', '-f', '/tmp/copia.dump'], { silencio: true });

  console.log('4/5 · Marcándola como copia local…');
  psql(`
    CREATE TABLE IF NOT EXISTS entorno_local (copiado_at timestamptz NOT NULL DEFAULT now(), nota text);
    INSERT INTO entorno_local (nota) VALUES ('Copia de producción para pruebas en este PC (scripts/entorno-local)');
    COMMENT ON DATABASE telecab IS 'COPIA LOCAL DE PRUEBAS: no es producción';`);

  console.log('5/5 · Quitándole el correo de procesos…');
  psql(`UPDATE config_app SET valor = 'no' WHERE clave = 'correo_activo';
        UPDATE config_app SET valor = '' WHERE clave = 'correo_pass_cifrada';`);

  const n = psql(`SELECT (SELECT count(*) FROM conductor) || ' conductores · ' ||
                         (SELECT count(*) FROM usuario) || ' usuarios · ' ||
                         (SELECT pg_size_pretty(pg_database_size('telecab'))) || ' en disco';`).stdout.trim();
  console.log(`\nHecho en ${Math.round((Date.now() - t0) / 1000)} s: ${n}.`);
  if (avisos.length) {
    console.log(`\n${avisos.length} aviso(s) de pg_restore:`);
    avisos.slice(0, 20).forEach(l => console.log('  ' + l.trim()));
  }
  console.log('\nArráncalo con:  node scripts/entorno-local/arrancar.js');
})().catch(e => { console.error('\nNO SE HA PODIDO REFRESCAR: ' + e.message); process.exit(1); });
