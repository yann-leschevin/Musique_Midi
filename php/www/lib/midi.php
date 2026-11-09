<?php
// Fonctions du lecteur MIDI (portage PHP de l'ancien app.py Flask).
// Compatible PHP 7.4+ ; n'utilise ni mbstring ni intl.

require_once __DIR__ . '/config.php';

const SAFE_NAME_RE = '/^[A-Za-z0-9][A-Za-z0-9._\- ()\[\]]{0,180}$/';

// --------------------------------------------------------------------------
//  Réponses HTTP
// --------------------------------------------------------------------------

function json_response(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function json_error(int $code, string $message): void
{
    json_response(['ok' => false, 'code' => $code, 'error' => $message], $code);
    exit;
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        json_error(405, 'Méthode non autorisée.');
    }
}

// --------------------------------------------------------------------------
//  Sécurité des noms de fichiers
// --------------------------------------------------------------------------

function ends_with_ci(string $texte, string $fin): bool
{
    return strtolower(substr($texte, -strlen($fin))) === $fin;
}

/** Nom de fichier sûr, ou null s'il est rejeté. */
function sanitize_filename($raw): ?string
{
    if (!is_string($raw)) {
        return null;
    }
    $name = trim($raw);
    if ($name === '' || strlen($name) > 200) {
        return null;
    }
    if (strpbrk($name, "\0/\\") !== false || strpos($name, '..') !== false) {
        return null;
    }
    if (!preg_match(SAFE_NAME_RE, $name)) {
        return null;
    }
    foreach (ALLOWED_EXTENSIONS as $ext) {
        if (ends_with_ci($name, $ext)) {
            return $name;
        }
    }
    return null;
}

/** Chemin réel d'un fichier dans midis/, sans possibilité d'en sortir. */
function midi_path_for(string $name): ?string
{
    $safe = sanitize_filename($name);
    $base = realpath(MIDI_DIR);
    if ($safe === null || $base === false) {
        return null;
    }
    $target = $base . DIRECTORY_SEPARATOR . $safe;
    $real = realpath($target); // suit les liens symboliques
    if ($real !== false && dirname($real) !== $base) {
        return null;
    }
    return $target;
}

/** Validation minimale d'un fichier MIDI standard (SMF, formats 0 et 1). */
function validate_midi_bytes(string $data): array
{
    $len = strlen($data);
    if ($len < 14) {
        return [false, 'fichier trop court pour être un MIDI'];
    }
    if (substr($data, 0, 4) !== 'MThd') {
        return [false, "en-tête MThd absent (ce n'est pas un fichier MIDI)"];
    }
    $headerLen = unpack('N', substr($data, 4, 4))[1];
    if ($headerLen < 6 || 8 + $headerLen > $len) {
        return [false, "longueur d'en-tête MThd invalide"];
    }
    $h = unpack('nfmt/nntrks/ndivision', substr($data, 8, 6));
    if ($h['fmt'] !== 0 && $h['fmt'] !== 1) {
        return [false, sprintf('format MIDI %d non pris en charge (formats 0 et 1 uniquement)', $h['fmt'])];
    }
    if ($h['ntrks'] < 1) {
        return [false, 'aucune piste déclarée'];
    }
    if ($h['division'] === 0) {
        return [false, 'division temporelle nulle'];
    }
    $pos = 8 + $headerLen;
    for ($seen = 0; $seen < $h['ntrks']; $seen++) {
        if ($pos + 8 > $len) {
            return [false, 'bloc de piste MTrk manquant'];
        }
        if (substr($data, $pos, 4) !== 'MTrk') {
            return [false, 'bloc de piste MTrk manquant (chunk inconnu)'];
        }
        $trackLen = unpack('N', substr($data, $pos + 4, 4))[1];
        $pos += 8;
        if ($pos + $trackLen > $len) {
            return [false, 'longueur de piste dépassée (fichier tronqué ?)'];
        }
        $pos += $trackLen;
    }
    return [true, sprintf('SMF format %d, %d piste(s)', $h['fmt'], $h['ntrks'])];
}

// --------------------------------------------------------------------------
//  Classement par artiste (arborescence de la colonne de gauche)
// --------------------------------------------------------------------------

const ARTIST_CANONICAL = [
    'Bach, Johann Sebastian' => ['bach', 'j s bach', 'johann sebastian bach'],
    'Bach, Johann Michael' => ['j m bach', 'johann michael bach'],
    'Beethoven, Ludwig van' => ['beethoven', 'l v beethoven', 'ludwig van beethoven'],
    'Brahms, Johannes' => ['brahms', 'j brahms', 'johannes brahms'],
    'Burgmüller, Friedrich' => ['burgmuller', 'j f f burgmuller', 'friedrich burgmuller'],
    'Chopin, Frédéric' => ['chopin', 'f f chopin', 'f chopin', 'frederic chopin'],
    'Clementi, Muzio' => ['clementi', 'm clementi', 'muzio clementi'],
    'Czerny, Carl' => ['czerny', 'c czerny', 'carl czerny'],
    'Debussy, Claude' => ['debussy', 'claude debussy'],
    'Dvořák, Antonín' => ['dvorak', 'antonin dvorak'],
    'Grieg, Edvard' => ['grieg', 'e grieg', 'edvard grieg'],
    'Haendel, Georg Friedrich' => ['handel', 'haendel', 'g f handel', 'george frideric handel'],
    'Haydn, Joseph' => ['haydn', 'f j haydn', 'joseph haydn'],
    'Joplin, Scott' => ['joplin', 's joplin', 'scott joplin'],
    'Lefébure-Wély, Louis James Alfred' => ['louis james alfred lefebure wely', 'lefebure wely'],
    'Liszt, Franz' => ['liszt', 'f liszt', 'franz liszt', 'franz liszt after the traditiona'],
    'Mendelssohn, Felix' => ['mendelssohn', 'f mendelssohn bartholdy', 'felix mendelssohn'],
    'Mozart, Wolfgang Amadeus' => ['mozart', 'w a mozart', 'wolfgang amadeus mozart'],
    'Pezold, Christian' => ['pezold', 'petzold', 'christian pezold', 'christian petzold'],
    'Satie, Erik' => ['satie', 'e satie', 'erik satie'],
    'Schubert, Franz' => ['schubert', 'f schubert', 'franz schubert'],
    'Schumann, Robert' => ['schumann', 'r schumann', 'robert schumann'],
    'Sousa, John Philip' => ['sousa', 'j p sousa', 'john philip sousa'],
    'Tchaïkovski, Piotr Ilitch' => ['tchaikovsky', 'p i tchaikovsky', 'pyotr ilyich tchaikovsky'],
    'Verdi, Giuseppe' => ['verdi', 'g verdi', 'giuseppe verdi'],
    'Vivaldi, Antonio' => ['vivaldi', 'antonio vivaldi'],
];

const TRADITIONAL_ORIGINS = [
    'brazilian' => 'brésilien',
    'english' => 'anglais',
    'french' => 'français',
    'german' => 'allemand',
    'jamaican' => 'jamaïcain',
    'polish' => 'polonais',
];

const NAME_PARTICLES = ['van', 'von', 'de', 'da', 'di', 'du', 'le', 'la'];

/** Retire les accents (sans dépendre de l'extension intl). */
function strip_accents(string $text): string
{
    if (class_exists('Normalizer')) {
        $nfd = Normalizer::normalize($text, Normalizer::FORM_D);
        if ($nfd !== false) {
            return preg_replace('/\p{Mn}+/u', '', $nfd);
        }
    }
    $map = [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ç' => 'c', 'č' => 'c',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'ě' => 'e', 'ì' => 'i', 'í' => 'i', 'î' => 'i',
        'ï' => 'i', 'ñ' => 'n', 'ň' => 'n', 'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
        'ř' => 'r', 'š' => 's', 'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ů' => 'u', 'ý' => 'y',
        'ÿ' => 'y', 'ž' => 'z',
        'À' => 'A', 'Á' => 'A', 'Â' => 'A', 'Ä' => 'A', 'Ç' => 'C', 'Č' => 'C', 'È' => 'E', 'É' => 'E',
        'Ê' => 'E', 'Ë' => 'E', 'Î' => 'I', 'Ï' => 'I', 'Ñ' => 'N', 'Ô' => 'O', 'Ö' => 'O', 'Ř' => 'R',
        'Š' => 'S', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ž' => 'Z',
    ];
    return strtr($text, $map);
}

/** Minuscules sans accents (clé de tri / de recherche). */
function plain(string $text): string
{
    $text = strtolower(strip_accents($text));
    $text = str_replace(['_', '-'], ' ', $text);
    return trim(preg_replace('/\s+/', ' ', $text));
}

function artist_aliases(): array
{
    static $aliases = null;
    if ($aliases === null) {
        $aliases = [];
        foreach (ARTIST_CANONICAL as $display => $variants) {
            foreach ($variants as $variant) {
                $aliases[plain($variant)] = [$display, plain($display)];
            }
        }
    }
    return $aliases;
}

/** [affichage "Nom, Prénom", clé de tri] pour un préfixe brut. */
function canonical_artist(string $raw): array
{
    $aliases = artist_aliases();
    $key = plain($raw);
    if (isset($aliases[$key])) {
        return $aliases[$key];
    }
    $words = preg_split('/\s+/', trim(str_replace('_', ' ', $raw)), -1, PREG_SPLIT_NO_EMPTY);
    if ($words && strtolower($words[0]) === 'traditional') {
        $origin = implode(' ', array_slice($words, 1));
        $origin = TRADITIONAL_ORIGINS[strtolower($origin)] ?? $origin;
        $display = $origin !== '' ? "Traditionnel ($origin)" : 'Traditionnel';
        return [$display, plain($display)];
    }
    if (count($words) <= 1) {
        $display = $words[0] ?? 'Divers / Inconnu';
        return [$display, plain($display)];
    }
    $start = count($words) - 1;
    while ($start > 1 && in_array(strtolower($words[$start - 1]), NAME_PARTICLES, true)) {
        $start--;
    }
    $display = implode(' ', array_slice($words, $start)) . ', ' . implode(' ', array_slice($words, 0, $start));
    return [$display, plain($display)];
}

function strip_ext(string $name): string
{
    foreach (['.midi', '.mid'] as $ext) {
        if (ends_with_ci($name, $ext)) {
            return substr($name, 0, -strlen($ext));
        }
    }
    return $name;
}

/** Décompose "<Artiste> - <Titre>.mid" en [artiste, clé de tri, titre]. */
function artist_info(string $filename): array
{
    $aliases = artist_aliases();
    $stem = strip_ext($filename);
    if ($filename === 'EMPEROR.mid') {
        return array_merge($aliases['beethoven'], ["Concerto pour piano n° 5 « L'Empereur »"]);
    }
    if (strpos($filename, ' - ') !== false) {
        [$rawArtist, $rawTitle] = explode(' - ', $stem, 2);
        $title = trim(str_replace('_', ' ', $rawTitle));
        return array_merge(canonical_artist($rawArtist), [$title !== '' ? $title : $stem]);
    }
    $lower = strtolower($filename);
    foreach (['johannes brahms' => 'brahms', 'j_m_bach_' => 'j m bach'] as $prefix => $alias) {
        if (strpos($lower, $prefix) === 0) {
            $title = trim(str_replace('_', ' ', substr($stem, strlen($prefix))));
            return array_merge($aliases[$alias], [$title !== '' ? $title : $stem]);
        }
    }
    $title = trim(str_replace('_', ' ', $stem));
    if ($title === '') {
        $title = $filename;
    }
    if (strpos($filename, 'demo_') === 0 || strpos($filename, 'demo ') === 0) {
        return ['Démos du projet', 'zzz demos du projet', $title];
    }
    return ['Divers / Inconnu', 'zzz divers / inconnu', $title];
}

/** Liste des fichiers MIDI, enrichie et triée par artiste puis titre. */
function list_midi_files(): array
{
    if (!is_dir(MIDI_DIR)) {
        return [];
    }
    $entries = [];
    foreach (scandir(MIDI_DIR) ?: [] as $name) {
        $path = MIDI_DIR . '/' . $name;
        if (!is_file($path) || sanitize_filename($name) === null) {
            continue;
        }
        [$artist, $key, $title] = artist_info($name);
        $entries[] = [
            'name' => $name,
            'size' => filesize($path),
            'modified' => filemtime($path),
            'artist' => $artist,
            'artist_key' => $key,
            'title' => $title,
        ];
    }
    usort($entries, function (array $a, array $b): int {
        // strcmp (ordre binaire) : <=> comparerait "10" et "9" comme des nombres.
        return strcmp($a['artist_key'], $b['artist_key'])
            ?: strcmp(strtolower($a['title']), strtolower($b['title']))
            ?: strcmp(strtolower($a['name']), strtolower($b['name']));
    });
    return $entries;
}

/** Regroupe une liste déjà triée par artiste. */
function group_midi_files(array $files): array
{
    $groups = [];
    $current = -1;
    $currentKey = null;
    foreach ($files as $item) {
        if ($current < 0 || $item['artist_key'] !== $currentKey) {
            $groups[] = ['artist' => $item['artist'], 'artist_key' => $item['artist_key'], 'count' => 0, 'files' => []];
            $current++;
            $currentKey = $item['artist_key'];
        }
        $groups[$current]['files'][] = $item;
        $groups[$current]['count']++;
    }
    return $groups;
}
