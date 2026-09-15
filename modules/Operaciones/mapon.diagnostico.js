// ============================================================
// DIAGNÓSTICO DE MAPON — la herramienta, no una pantalla
// ============================================================
// ¿Deja Mapon crear y asignar conductores con esta clave? ¿Tiene este coche
// relé de corte? ¿Qué devuelve TAL CUAL para esta matrícula?
//
// Existe porque los nombres de los campos de Mapon —`mileage`, `last_update`—
// y sus unidades no están documentados en ningún sitio nuestro, y porque el
// error 1006 del relé podía ser de permiso o de que estuviéramos mandando mal
// la petición. Aquí se ve, y se deja de suponer.
//
// ── LO QUE HAY QUE SABER ────────────────────────────────────────────────────
//
// · SOLO LECTURA POR OMISIÓN. Sin parámetros no toca nada. Las opciones que SÍ
//   actúan sobre un coche están marcadas abajo una a una.
//
// · NUNCA SE TOCA UN COCHE EN MARCHA. Antes de mandar cualquier orden al relé
//   se pregunta la velocidad, y si va rodando no se manda nada. Esto no es una
//   cortesía: cortar el motor a un coche con un pasajero dentro es lo único
//   irreversible que hay en todo el ERP.
//
// · NADA DE ESTO ESTÁ ENLAZADO EN NINGUNA PANTALLA, a propósito. Se llama por
//   URL cuando hace falta, y quien la escribe sabe lo que hace.

const mapon = require('../../services/mapon');

/**
 * @param {object} q los parámetros tal y como llegan por la URL.
 *   ?buscar=Claude          conductores cuyo nombre coincide (para ver DUPLICADOS)
 *   ?matricula=0417MMZ      resuelve la unidad y dice qué conductor tiene puesto
 *   ?reles=1                ¿tienen los coches relé instalado? (solo lectura)
 *   ?crudo=1                qué devuelve Mapon TAL CUAL para esa unidad
 *   ?comandos=1             CATÁLOGO de comandos de esa unidad (solo lectura)
 *   ?ejecutar=<nombre>      EJECUTA ese comando  ← ACTÚA SOBRE EL COCHE
 *   ?probarrele=0|1         prueba el corte por POST y por GET  ← ACTÚA
 *   ?rele=0|1               corta o libera el motor             ← ACTÚA
 *   ?repaso=1|aplicar       simula (o aplica) el repaso de bloqueos
 *   ?crear=NOMBRE           crea el conductor si no existe      ← ESCRIBE
 *   ?asignar=1  ?soltar=1   le pone o le quita el coche         ← ESCRIBE
 */
async function diagnostico(q = {}) {
  const out = { clave: !!process.env.MAPON_API_KEY };
  let lista = [];
  try {
    lista = await mapon.listarConductores();
    out.conductores = lista.length;
  } catch (e) { out.errorLista = e.message; }

  const buscar = (q.buscar || '').toString().trim().toLowerCase();
  if (buscar) {
    out.coincidencias = lista
      .map(d => ({ id: d.id || d.driver_id, nombre: `${d.name || ''} ${d.surname || ''}`.trim(), tel: d.phone || '' }))
      .filter(d => d.nombre.toLowerCase().includes(buscar));
  }

  let unitId = q.unit ? String(q.unit) : null;
  if (q.matricula) {
    const u = await mapon.unidadPorMatricula(q.matricula).catch(e => { out.errorUnidad = e.message; return null; });
    if (u) { unitId = String(u.unitId); out.unidad = { unitId: u.unitId, matricula: u.matricula, vehiculo: u.vehiculo }; }
    else out.unidad = null;
  }
  if (unitId) {
    try { out.conductoresDeLaUnidad = await mapon.conductoresDeUnidad(unitId); }
    catch (e) { out.errorConductoresUnidad = e.message; }
  }

  if (q.reles) {
    try { out.reles = await mapon.relesDeFlota(); }
    catch (e) { out.errorReles = e.message; }
  }

  // Sirve para distinguir "no tiene relé" de "no lo pedimos bien".
  if (q.crudo && unitId) {
    try { out.crudo = await mapon.crudoUnidad(unitId); }
    catch (e) { out.errorCrudo = e.message; }
  }

  // El catálogo de comandos (`unit_commands`, la vía que Mapon confirmó por
  // correo el 18/08/2026). Solo lectura: hasta no ver los nombres reales no se
  // manda nada.
  if (q.comandos && unitId) {
    try { out.comandos = await mapon.comandosDisponibles(unitId); }
    catch (e) { out.errorComandos = e.message; }
  }

  // ── A PARTIR DE AQUÍ SE ACTÚA SOBRE EL COCHE ─────────────────────────────

  // Se comprueba antes que el comando exista en el catálogo de esa unidad; si
  // no, se devuelve la lista real y no se manda nada.
  if (q.ejecutar && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId).catch(() => null);
      if (info && info.enMarcha) {
        out.errorEjecutar = `Coche en marcha (${info.velocidad} km/h): no se manda nada`;
      } else {
        out.antesDeEjecutar = info;
        out.ejecucion = await mapon.ejecutarComandoSeguro({ unitId, command: String(q.ejecutar) });
      }
    } catch (e) { out.errorEjecutar = e.message; }
  }

  // La evidencia para saber si el 1006 es de PERMISO o si estamos mandando mal
  // la petición (no cambia nada en el coche si no tiene permiso).
  if (q.probarrele && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId);
      const rele = mapon.releDeCorte(info);
      if (!rele) out.errorProbar = 'Ese vehículo no reporta relé';
      else if (info.enMarcha) out.errorProbar = `Coche en marcha (${info.velocidad} km/h): no se prueba`;
      else {
        out.pruebaRele = await mapon.probarRele({
          unitId, relayId: rele.relay_id, estado: String(q.probarrele) === '1' ? 0 : 1,
        });
      }
    } catch (e) { out.errorProbar = e.message; }
  }

  // Corta el motor y CONFIRMA el estado real: `change_relay` solo dice que la
  // orden salió. 0/1 lo decide quien llama: qué valor bloquea y cuál libera se
  // comprueba mirando el coche, no adivinando.
  if (q.rele !== undefined && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId);
      out.antesDeTodo = info;
      const rele = mapon.releDeCorte(info);
      if (!rele) out.errorRele = 'Ese vehículo no reporta ningún relé';
      else if (info.enMarcha) out.errorRele = `El coche está EN MARCHA (${info.velocidad} km/h): no se toca el relé`;
      else {
        out.rele = await mapon.cambiarReleConfirmado({
          unitId, relayId: rele.relay_id, estado: String(q.rele) === '1',
        });
      }
    } catch (e) { out.errorRele = e.message; }
  }

  // ?repaso=1 SIMULA: dice a qué coches se les cortaría el motor y por qué se
  // deja fuera a los demás, sin tocar ninguno. Es lo que hay que mirar ANTES de
  // encender FICHAJE_BLOQUEO_MOTOR: si aquí aparece un coche que está
  // trabajando, la regla está mal y no se enciende nada.
  // ?repaso=aplicar lo ejecuta de verdad (lo mismo que hace el cron).
  if (q.repaso) {
    try {
      const fj = require('../../services/fichaje');
      out.alcance = {
        bloqueoActivo: fj.BLOQUEO_ACTIVO,
        matriculas: fj.MATRICULAS,
        todaLaFlota: fj.TODA_LA_FLOTA,
        alcance: fj.TODA_LA_FLOTA ? 'toda la flota' : 'solo los coches que han pasado por el fichaje',
        telefonos: 'los de FICHAJE_TELEFONOS',
      };
      out.repaso = await fj.repasarBloqueos({ soloMirar: String(q.repaso) !== 'aplicar' });
    } catch (e) { out.errorRepaso = e.message; }
  }

  // Lo crea si no existe, o reutiliza el que ya haya con ese nombre.
  const nombre = (q.crear || '').toString().trim();
  if (nombre) {
    const yaEsta = lista.find(d => `${d.name || ''} ${d.surname || ''}`.trim().toLowerCase() === nombre.toLowerCase());
    try {
      let id = yaEsta ? (yaEsta.id || yaEsta.driver_id) : null;
      if (id) out.reutilizado = { id, nombre };
      else {
        const partes = nombre.split(/\s+/);
        id = await mapon.crearConductor({ nombre: partes[0], apellidos: partes.slice(1).join(' ') || '-' });
        out.creado = { id, nombre };
      }
      // La otra mitad del fichaje: la ASIGNACIÓN al coche.
      if (unitId && q.asignar) {
        try {
          await mapon.asignarConductor(id, unitId);
          out.asignado = `driver ${id} → unit ${unitId}`;
          out.compruebaEnUnidad = await mapon.conductoresDeUnidad(unitId).catch(() => null);
        } catch (e) { out.errorAsignar = e.message; }
      }
      // Para dejarlo como estaba.
      if (q.soltar) {
        try { await mapon.desasignarConductor(id); out.desasignado = id; }
        catch (e) { out.errorDesasignar = e.message; }
      }
    } catch (e) { out.errorCrear = e.message; }
  }
  return out;
}

/** Con qué límite está avisando Mapon ahora mismo. Su configuración, no sus datos. */
const setups = () => mapon.listarSetups();

module.exports = { diagnostico, setups };
