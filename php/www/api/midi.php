<?php
// GET api/midi.php?name=<fichier> : envoie un fichier du dossier midis/.
require __DIR__ . '/../lib/midi.php';
require_method('GET');

$path = midi_path_for((string) ($_GET['name'] ?? ''));
if ($path === null) {
    json_error(400, 'Nom de fichier invalide.');
}
if (!is_file($path)) {
    json_error(404, 'Fichier MIDI introuvable.');
}
$size = filesize($path);
if ($size === false) {
    json_error(500, 'Lecture du fichier impossible.');
}
if ($size > MAX_MIDI_SIZE) {
    json_error(413, 'Fichier trop volumineux (max 5 Mo).');
}
header('Content-Type: audio/midi');
header('Content-Length: ' . $size);
header('Content-Disposition: inline; filename="' . basename($path) . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
readfile($path);
