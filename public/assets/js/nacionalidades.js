// ─────────────────────────────────────────────────────────────────────────
// Nacionalidades (gentilicio en español) basadas en ISO 3166-1.
// Es una lista de SUGERENCIAS para el campo Nacionalidad: aparece como
// autocompletado (datalist), pero se puede teclear cualquier otra.
// Gentilicio en femenino singular, que es la forma habitual en la ficha de alta.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const LISTA = [
    // Europa
    'Española', 'Portuguesa', 'Francesa', 'Italiana', 'Alemana', 'Británica',
    'Irlandesa', 'Neerlandesa', 'Belga', 'Luxemburguesa', 'Suiza', 'Austriaca',
    'Danesa', 'Sueca', 'Noruega', 'Finlandesa', 'Islandesa', 'Polaca', 'Checa',
    'Eslovaca', 'Húngara', 'Rumana', 'Búlgara', 'Griega', 'Croata', 'Eslovena',
    'Serbia', 'Bosnia', 'Montenegrina', 'Macedonia', 'Albanesa', 'Kosovar',
    'Ucraniana', 'Rusa', 'Bielorrusa', 'Moldava', 'Lituana', 'Letona', 'Estonia',
    'Maltesa', 'Chipriota', 'Andorrana', 'Georgiana', 'Armenia', 'Azerbaiyana',
    'Turca',
    // América
    'Argentina', 'Boliviana', 'Brasileña', 'Canadiense', 'Chilena', 'Colombiana',
    'Costarricense', 'Cubana', 'Dominicana', 'Ecuatoriana', 'Salvadoreña',
    'Estadounidense', 'Guatemalteca', 'Haitiana', 'Hondureña', 'Jamaicana',
    'Mexicana', 'Nicaragüense', 'Panameña', 'Paraguaya', 'Peruana',
    'Puertorriqueña', 'Uruguaya', 'Venezolana',
    // África
    'Marroquí', 'Argelina', 'Tunecina', 'Libia', 'Egipcia', 'Mauritana',
    'Saharaui', 'Senegalesa', 'Gambiana', 'Maliense', 'Guineana',
    'Ecuatoguineana', 'Marfileña', 'Ghanesa', 'Nigeriana', 'Nigerina',
    'Camerunesa', 'Beninesa', 'Togolesa', 'Burkinesa', 'Sierraleonesa',
    'Liberiana', 'Caboverdiana', 'Angoleña', 'Mozambiqueña', 'Congoleña',
    'Keniana', 'Etíope', 'Somalí', 'Sudanesa', 'Tanzana', 'Ugandesa',
    'Zimbabuense', 'Sudafricana',
    // Asia y Oriente Medio
    'China', 'Japonesa', 'Surcoreana', 'Filipina', 'Vietnamita', 'Tailandesa',
    'Indonesia', 'Malasia', 'India', 'Pakistaní', 'Bangladesí', 'Nepalí',
    'Srilanquesa', 'Birmana', 'Afgana', 'Iraní', 'Iraquí', 'Siria', 'Libanesa',
    'Jordana', 'Israelí', 'Palestina', 'Saudí', 'Emiratí', 'Catarí', 'Kuwaití',
    'Yemení', 'Kazaja', 'Uzbeka',
    // Oceanía
    'Australiana', 'Neozelandesa'
  ];
  // Se ordenan alfabéticamente (español) para el desplegable.
  window.NACIONALIDADES = LISTA.slice().sort((a, b) => a.localeCompare(b, 'es'));
})();
