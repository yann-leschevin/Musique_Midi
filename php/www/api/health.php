<?php
// GET api/health.php : état du serveur.
require __DIR__ . '/../lib/midi.php';
require_method('GET');

json_response([
    'ok' => true,
    'backend' => 'php',
    'php_version' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
    'max_size' => MAX_MIDI_SIZE,
    'allowed_extensions' => ALLOWED_EXTENSIONS,
    'upload_enabled' => UPLOAD_ENABLED,
    'midi_dir' => 'midis',
    'midi_dir_exists' => is_dir(MIDI_DIR),
]);
