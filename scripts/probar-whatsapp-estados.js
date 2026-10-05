// ============================================================
// LO QUE META DICE DE NUESTROS ENVÍOS, sin base de datos ni Meta
// ============================================================
//   node scripts/probar-whatsapp-estados.js
//
// La base de mentira apunta cada consulta con sus parámetros y hace de tabla:
// guarda el estado de cada mensaje y los excesos de velocidad. Comprueba lo que
// importa de services/repo/whatsappEnvios.js (05/10/2026):
//   · cada estado se apunta, y no retrocede (un «entregado» tardío no tapa un «leído»);
//   · un FALLIDO pasa a `error` el exceso de velocidad avisado con ese mensaje;
//   · sin db/176 (falta la tabla) el exceso se marca igual y no se lanza nada.
// Los excesos van por su `clave`: la tabla no tiene `id` (lo cazó el PREPARE).
const path = require('path');
const Modulo = require('module');

const tabla = new Map();          // wamid -> { estado }
const excesos = [{ clave: '893925|7', envio_id: 'wamid.FALLA', estado: 'avisado', nota: '' },
                 { clave: '893925|8', envio_id: 'wamid.BIEN', estado: 'avisado', nota: '' }];
const consultas = [];
let sinTabla = false;
const RANGO = { enviado: 1, entregado: 2, leido: 3, fallido: 4 };

const cargar = Modulo._load;
Modulo._load = function (peticion, padre) {
  if (peticion === '../db' && padre && padre.filename.endsWith('whatsappEnvios.js')) {
    return {
      consulta: async (sql, p) => {
        consultas.push({ sql, p });
        if (/UPDATE velocidad_exceso/.test(sql)) {
          const hechos = excesos.filter(e => e.envio_id === p[0] && e.estado === 'avisado');
          hechos.forEach(e => { e.estado = 'error'; e.nota = `no entregado (${p[1]})`; });
          return { rowCount: hechos.length, rows: hechos.map(e => ({ clave: e.clave })) };
        }
        if (/INSERT INTO whatsapp_envio/.test(sql)) {
          if (sinTabla) throw Object.assign(new Error('relation "whatsapp_envio" does not exist'), { code: '42P01' });
          const [wamid, , estado] = p;
          const ya = tabla.get(wamid);
          if (!ya || p[6] > RANGO[ya.estado]) tabla.set(wamid, { estado, codigo: p[4] ?? (ya && ya.codigo) });
          return { rowCount: 1, rows: [] };
        }
        throw new Error('consulta no prevista');
      },
    };
  }
  return cargar.apply(this, arguments);
};
const { registrarEstados } = require(path.join(__dirname, '..', 'services', 'repo', 'whatsappEnvios.js'));
Modulo._load = cargar;

let mal = 0;
const comprobar = (t, ok, d) => { if (!ok) mal++; console.log(`  ${ok ? 'ok' : 'MAL'}  ${t}${!ok && d ? '  → ' + d : ''}`); };
const st = (id, status, ts, extra = {}) => ({ id, status, timestamp: String(ts), recipient_id: '34600000001', ...extra });
const FALLO = { errors: [{ code: 131042, title: 'Business eligibility payment issue',
  error_data: { details: 'Message failed to send because your WhatsApp Business account has unsettled payments.' } }] };

(async () => {
  console.log('\n1. Los estados avanzan y no retroceden');
  await registrarEstados([st('wamid.BIEN', 'sent', 1791192700), st('wamid.BIEN', 'read', 1791192760)]);
  await registrarEstados([st('wamid.BIEN', 'delivered', 1791192730)]);   // llega tarde
  comprobar('un «entregado» tardío no tapa el «leído»', tabla.get('wamid.BIEN').estado === 'leido', JSON.stringify(tabla.get('wamid.BIEN')));
  comprobar('el exceso de un mensaje que llegó sigue avisado', excesos[1].estado === 'avisado');

  console.log('\n2. Un mensaje FALLIDO');
  const r = await registrarEstados([st('wamid.FALLA', 'sent', 1791192780), st('wamid.FALLA', 'failed', 1791192785, FALLO)]);
  comprobar('se apunta como fallido, con su código', tabla.get('wamid.FALLA').estado === 'fallido' && tabla.get('wamid.FALLA').codigo === 131042,
    JSON.stringify(tabla.get('wamid.FALLA')));
  comprobar('su exceso de velocidad pasa a «error»', excesos[0].estado === 'error' && /131042/.test(excesos[0].nota), JSON.stringify(excesos[0]));
  comprobar('y lo cuenta', r.fallidos === 1 && r.excesos === 1, JSON.stringify(r));
  const upd = consultas.filter(c => /UPDATE velocidad_exceso/.test(c.sql));
  comprobar('solo toca el exceso de ESE mensaje y solo si estaba avisado',
    upd.length === 1 && upd[0].p[0] === 'wamid.FALLA' && /estado = 'avisado'/.test(upd[0].sql));
  await registrarEstados([st('wamid.FALLA', 'failed', 1791192790, FALLO)]);
  comprobar('un segundo «fallido» no lo vuelve a contar', excesos[0].nota.match(/no entregado/g).length === 1);

  console.log('\n3. Sin db/176');
  sinTabla = true;
  excesos.push({ clave: '893925|9', envio_id: 'wamid.SIN', estado: 'avisado', nota: '' });
  let lanzo = false;
  try { await registrarEstados([st('wamid.SIN', 'failed', 1791192800, FALLO)]); } catch (e) { lanzo = true; }
  comprobar('no lanza', !lanzo);
  comprobar('el exceso se marca igual', excesos[2].estado === 'error');

  console.log('\n4. Lo que no es un estado');
  const antes = consultas.length;
  await registrarEstados([{ id: 'x', status: 'deleted' }, { status: 'sent' }, null]);
  comprobar('se ignora sin consultar nada', consultas.length === antes);

  console.log(mal ? `\n${mal} MAL` : '\nTodo cuadra');
  process.exitCode = mal ? 1 : 0;
})();
