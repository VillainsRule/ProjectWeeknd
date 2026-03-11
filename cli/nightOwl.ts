const TARGET = '';

// -------------------------------

import fs from 'node:fs';
import path from 'node:path';

interface HistoryFile {
    type: 'song';
    name: string;
    url: string;
    artists: { name: string, url: string }[];
    album: string;
    albumRelease: string;
    albumArt: string;
    started: number;
    ended: number;
    final?: boolean;
}

const dataDir = path.join(import.meta.dirname, '..', 'data');
const historyDir = path.join(dataDir, 'history');

const oauthFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'oauth.json'), 'utf8')) as any[];
const target = oauthFile.find(u => u.user.display_name === TARGET).user.uri;

const historyPath = path.join(historyDir, target + '.json');
const historyFile = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as HistoryFile[];

const EST_OFFSET_MS = -5 * 60 * 60 * 1000;

const isNightOwl = (timestampMs: number): boolean => {
    const estDate = new Date(timestampMs + EST_OFFSET_MS);
    const hours = estDate.getUTCHours();
    const minutes = estDate.getUTCMinutes();

    const afterElevenPM = hours >= 25; // disabled for now
    const beforeSixThirtyAM = hours < 6; // disabled for now || (hours === 6 && minutes < 30);

    return afterElevenPM || beforeSixThirtyAM;
};

const formatEST = (timestampMs: number): string => {
    const estDate = new Date(timestampMs + EST_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${estDate.getUTCFullYear()}-${pad(estDate.getUTCMonth() + 1)}-${pad(estDate.getUTCDate())} ` +
           `${pad(estDate.getUTCHours())}:${pad(estDate.getUTCMinutes())}:${pad(estDate.getUTCSeconds())} EST`;
};

const nightSongs = historyFile.filter(entry => {
    if (entry.type !== 'song') return false;
    if ((entry.ended - entry.started) <= 10000) return false;
    return isNightOwl(entry.started);
});

if (nightSongs.length === 0) {
    console.log('no songs found in the requested ranges');
    process.exit(0);
}

console.log(`found ${nightSongs.length} plays\n`);
console.log('─'.repeat(80));

const byDate: { [date: string]: HistoryFile[] } = {};

for (const entry of nightSongs) {
    const estDate = new Date(entry.started + EST_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, '0');
    const hours = estDate.getUTCHours();
    let dateKey: string;
    if (hours < 7) {
        const prev = new Date(estDate.getTime() - 24 * 60 * 60 * 1000);
        dateKey = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
    } else dateKey = `${estDate.getUTCFullYear()}-${pad(estDate.getUTCMonth() + 1)}-${pad(estDate.getUTCDate())}`;

    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(entry);
}

for (const [date, songs] of Object.entries(byDate).sort()) {
    const totalMs = songs.reduce((acc, s) => acc + (s.ended - s.started), 0);
    const totalMin = Math.round(totalMs / 1000 / 60);
    console.log(`\n> night of ${date} — ${songs.length} song(s), ~${totalMin} min total`);

    for (const song of songs) {
        const startStr = formatEST(song.started);
        const durationSec = Math.round((song.ended - song.started) / 1000);
        const durStr = durationSec >= 60
            ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
            : `${durationSec}s`;

        console.log(`  ## ${song.name}`);
        console.log(`     by ${song.artists.map(a => a.name).join(', ')}`);
        console.log(`     started: ${startStr} | duration: ${durStr}`);
    }
}

console.log('\n' + '─'.repeat(80));
console.log(`\ntotal unique nights: ${Object.keys(byDate).length}`);
console.log(`total late-night plays: ${nightSongs.length}\n`);