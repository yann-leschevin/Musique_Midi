<?php
// Réglages du lecteur MIDI « Maestro ». Dossier protégé (lib/.htaccess).

// Dossier des fichiers MIDI (protégé du web par midis/.htaccess).
const MIDI_DIR = __DIR__ . '/../midis';

// Taille maximale d'un fichier MIDI : 5 Mo.
const MAX_MIDI_SIZE = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.mid', '.midi'];

// Envoi de fichiers par les visiteurs (bouton « Ajouter à la bibliothèque »).
// DÉSACTIVÉ par défaut sur un site public : n'importe qui pourrait remplir
// l'hébergement ou y déposer des fichiers protégés par le droit d'auteur.
// Lire un fichier depuis son ordinateur reste possible (tout se passe
// dans le navigateur, rien n'est envoyé).
const UPLOAD_ENABLED = false;
