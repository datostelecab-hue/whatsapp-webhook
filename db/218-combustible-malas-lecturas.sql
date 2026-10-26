-- ============================================================
-- 218 · LAS MALAS LECTURAS DE MAPON: VOLVER A MIRAR EL GPS
-- ============================================================
-- Camilo, 26/10/2026, con la ficha del 0626MMZ delante: «En estos momentos hay
-- muchos rojos por culpa de la zona» y «te muestro el ejemplo del por qué digo
-- que es mala lectura». El coche salía rojo a 19 km, «parado desde las 00:00»
-- en el Eje de O'Donnell, y esa noche hizo 14 viajes de BOLT.
--
-- Las coordenadas de las gasolineras no eran el problema: las del Excel de
-- Camilo (geocodificadas) quedan más lejos de las paradas reales de Mapon que
-- las de db/215, y cargarlas habría pasado 37 verdes a rojo y 550 a amarillo. De
-- los 31 GPS rojos y amarillos de Petroprix, 24 eran del equipo de Mapon o de la
-- hora, y la auditoría (combustible.auditoria) ya los mira distinto:
--
--   · LA PARADA DESMENTIDA. Si la parada que cubre la hora no sale verde y Mapon
--     la desmiente (la ruta que la cierra arranca a más de 300 m de ella, o tiene
--     dentro un punto del coche a más de 300 m), manda el punto del coche a esa
--     hora si es de 5 minutos o menos y queda más cerca de la gasolinera. Los
--     equipos del 1208MJY, el 1090MJY y el 9523MMX: 14 pasan a verde.
--   · LA PARADA ABIERTA, lejos, se mira por dentro hasta la hora: si el aforador
--     se mueve, el coche andaba (el 0626MMZ y el 0454MMZ: sin color, y se vuelve
--     a mirar mientras siga abierta).
--   · LA HORA QUE PASA DOS VECES Y EL EXCEL NO DICE CUÁL (25/10, 02:00-02:59):
--     se prueban las dos y, si solo cuadra una, se audita con esa y se corrige
--     la hora guardada. 7 rojos de esa noche eran la primera.
--   · Y una parada larga EN la gasolinera ya no se da por rota porque el aforador
--     se mueva dentro: el 9107LWS esperó 3,9 h encendido en el surtidor.
--
-- Los rojos de verdad no cambian: los del 8997LDK (Alcalá de Henares, Torrejón,
-- Campo Real) y el 8512LDS en Benalmádena. Medido con un ensayo en seco de la
-- auditoría nueva sobre los datos de hoy (docs/modulos/Combustible.md, «Las
-- malas lecturas de Mapon»).
--
-- QUÉ VUELVE A LA COLA. La auditoría no vuelve sola a lo acabado. Solo lo que
-- las reglas nuevas pueden cambiar, y solo lo 'hecha' o 'sin_datos' (lo
-- 'incompleta' ya está en la cola y su próximo intento ya mide así):
--
--   · el GPS medido desde una parada a 700 m o más (unos 23);
--   · las filas del Excel con la hora repetida sin decidir (11);
--   · las paradas dadas por rotas porque el aforador se movía dentro (unas 67:
--     las que estaban en la gasolinera vuelven a tener GPS; en el ensayo, una).
--
-- Se vuelven a auditar enteras (GPS y boya), como cualquier pendiente. Lo
-- medido se queda hasta entonces: la ficha sigue enseñando lo de antes. Los
-- intentos no se ponen a cero (como db/216): si Mapon no da más, se cierra antes
-- «sin datos» con lo que tenga. Unas 100 filas: dos pasadas del cron.
--
-- Lo de BOLT de las 7 de la hora repetida: al corregir la hora, la auditoría
-- vuelve a mirar quién llevaba el coche (en el bot siempre; en BOLT, si la fila
-- llegó hace menos de tres días: las de este Excel, hasta el 29/10 a las 09:35).
--
-- Aplicarla dos veces solo vuelve a auditar lo mismo. No se edita ninguna
-- migración anterior (docs/nucleo/Migraciones.md).

BEGIN;

UPDATE repostaje r
   SET auditoria_estado = 'pendiente',
       auditoria_detalle = COALESCE(auditoria_detalle, '{}'::jsonb) - 'soloBoya',
       actualizado_at = now()
 WHERE estado = 'leido'
   AND auditoria_estado IN ('hecha', 'sin_datos')
   AND ((gps_fuente = 'parada' AND gps_distancia_m >= 700)
        OR (to_jsonb(r) -> 'excel_crudo' ->> 'horaRepetida') = 'sin_saber'
        OR auditoria_detalle -> 'paradaRota' ->> 'como' = 'dentro');

COMMIT;
