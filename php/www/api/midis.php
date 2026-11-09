<?php
// GET api/midis.php : liste des fichiers MIDI groupés par artiste.
require __DIR__ . '/../lib/midi.php';
require_method('GET');

if (!is_dir(MIDI_DIR)) {
    json_response([
        'ok' => true, 'files' => [], 'groups' => [], 'max_size' => MAX_MIDI_SIZE,
        'warning' => "Le dossier 'midis/' est introuvable.",
    ]);
    exit;
}
$files = list_midi_files();
json_response(['ok' => true, 'files' => $files, 'groups' => group_midi_files($files), 'max_size' => MAX_MIDI_SIZE]);
