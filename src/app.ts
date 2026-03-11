import fs from 'node:fs';
import path from 'node:path';

import { Elysia, redirect, t } from 'elysia';

import CONFIG from '../config';

const SPOTIFY_AUTH = `Basic ${Buffer.from(`${CONFIG.SPOTIFY.CLIENT_ID}:${CONFIG.SPOTIFY.CLIENT_SECRET}`).toString('base64')}`;

const dataDir = path.join(import.meta.dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const app = new Elysia();

app.get('/login', () => {
    let scope = 'user-read-private user-read-email user-read-playback-state user-read-currently-playing';

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CONFIG.SPOTIFY.CLIENT_ID,
        scope: scope,
        redirect_uri: CONFIG.REDIRECT_URL,
        state: crypto.randomUUID().slice(0, 16)
    });

    return redirect('https://accounts.spotify.com/authorize?' + params.toString(), 302);
});

app.get('/cb', ({ query: { code } }) => {
    fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': SPOTIFY_AUTH
        },
        body: new URLSearchParams({
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': CONFIG.REDIRECT_URL
        })
    }).then(res => res.json()).then(json => {
        const access_token = json.access_token;
        const refresh_token = json.refresh_token;
        const token_expires = Date.now() + json.expires_in * 1000;

        fetch('https://api.spotify.com/v1/me', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${access_token}` }
        }).then(res => res.json()).then(userInfo => {
            const data = {
                access_token,
                refresh_token,
                token_expires,
                user: userInfo
            };

            console.log(data);

            const existingData = JSON.parse(fs.readFileSync(path.join(dataDir, 'oauth.json'), 'utf-8'));
            fs.writeFileSync(path.join(dataDir, 'oauth.json'), JSON.stringify([...existingData, data], null, 2));
        }).catch((err) => console.error('Error fetching user info:', err));
    });

    return redirect('https://spotify.com', 302);
}, { query: t.Object({ code: t.String() }) });

app.listen(1566, () => console.log('http://localhost:1566'));