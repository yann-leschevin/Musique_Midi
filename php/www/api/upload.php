<?php
// POST api/upload.php : reçoit un fichier MIDI (corps brut + en-tête X-File-Name).
// Désactivé tant que UPLOAD_ENABLED vaut false dans lib/config.php.
require __DIR__ . '/../lib/midi.php';
require_method('POST');

if (!UPLOAD_ENABLED) {
    json_error(403, "L'ajout de fichiers est désactivé sur ce serveur.");
}

$raw = trim((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? $_GET['name'] ?? ''));
if ($raw === '' || strpbrk($raw, "\0/\\") !== false || strpos($raw, '..') !== false) {
    json_error(400, 'Nom de fichier dangereux ou vide (chemin interdit).');
}
$safe = sanitize_filename($raw);
if ($safe === null) {
    json_error(400, 'Nom de fichier invalide (extension .mid ou .midi attendue).');
}
$declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($declared > MAX_MIDI_SIZE) {
    json_error(413, 'Fichier trop volumineux (max 5 Mo).');
}
$data = file_get_contents('php://input', false, null, 0, MAX_MIDI_SIZE + 1);
if ($data === false || $data === '') {
    json_error(400, 'Fichier vide.');
}
if (strlen($data) > MAX_MIDI_SIZE) {
    json_error(413, 'Fichier trop volumineux (max 5 Mo).');
}
[$ok, $info] = validate_midi_bytes($data);
if (!$ok) {
    json_error(400, 'Fichier MIDI invalide : ' . $info);
}
if (!is_dir(MIDI_DIR) && !mkdir(MIDI_DIR, 0755)) {
    json_error(500, 'Écriture du fichier impossible.');
}
$dest = MIDI_DIR . '/' . $safe;
$tmp = $dest . '.part';
if (file_put_contents($tmp, $data, LOCK_EX) === false || !rename($tmp, $dest)) {
    @unlink($tmp);
    json_error(500, 'Écriture du fichier impossible.');
}
json_response(['ok' => true, 'name' => $safe, 'size' => strlen($data), 'info' => $info, 'files' => list_midi_files()]);
