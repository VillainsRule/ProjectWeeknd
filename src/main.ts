const RECENT_COUNT = 7;

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    ComponentType,
    ContainerBuilder,
    GatewayIntentBits,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ThumbnailBuilder
} from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';

import Spotify from 'searchtify';

import CONFIG from '../config';

const spotify = new Spotify();

const dataDir = path.join(import.meta.dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const historyDir = path.join(dataDir, 'history');
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

interface DataJSON {
    access_token: string;
    refresh_token: string;
    token_expires: number;
    user: {
        uri: string;
        display_name: string;
    }
}

const oauthFile = path.join(dataDir, 'oauth.json');
const dataJSON = JSON.parse(fs.readFileSync(oauthFile, 'utf-8')) as DataJSON[];
const initialTarget = dataJSON.find(u => u.user.display_name === CONFIG.USER.spotifyName);
if (!initialTarget) {
    console.error('cannot find user with name', CONFIG.USER.spotifyName);
    process.exit(1);
}

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

const historyPath = path.join(historyDir, initialTarget.user.uri + '.json');
if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, '[]');
const historyFile = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as HistoryFile[];

const SPOTIFY_AUTH = `Basic ${Buffer.from(`${CONFIG.SPOTIFY.CLIENT_ID}:${CONFIG.SPOTIFY.CLIENT_SECRET}`).toString('base64')}`;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

interface SpotifyImage { url: string };

interface SpotifyShow {
    show: {
        description: string;
        publisher: string;
    };
    name: string;
    description: string;
    duration_ms: number;
    release_date: string;
    external_urls: { spotify: string };
    images: SpotifyImage[];
}

interface SpotifySong {
    name: string;
    external_urls: { spotify: string };
    artists: { name: string; external_urls: { spotify: string } }[];
    album: {
        name: string;
        album_type: string;
        external_urls: { spotify: string };
        release_date: string;
        images: SpotifyImage[];
    }
    popularity: number;
}

const createPanel = (song?: SpotifyShow | SpotifySong): [ContainerBuilder] => {
    const c = new ContainerBuilder();

    c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: '## ProjectWeeknd' });
    c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `**${CONFIG.MOTD}**` });
    c.addSeparatorComponents({ type: ComponentType.Separator });

    if (song) {
        if ('album' in song) c.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### [${song.name}](${song.external_urls.spotify})`))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `written by: ${song.artists.map(artist => `**[${artist.name}](${artist.external_urls.spotify})**`).join(', ')}`,
                `on album: **[${song.album.name}${song.album.album_type === 'single' ? ' (single)' : ''}](${song.album.external_urls.spotify})** (${formatDate(song.album.release_date)})`,
                `popularity score: ${song.popularity}/100`
            ].join('\n')))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(song.album.images[0].url))
        )
        else c.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### [${song.name}](${song.external_urls.spotify})`))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `publisher: ${song.show.publisher}`,
                `description: ${song.description.slice(0, 100)}`,
                `lasts ${Math.round(song.duration_ms / 1000 / 60)} min, released ${formatDate(song.release_date)}`
            ].join('\n')))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(song.images[0].url))
        ).addTextDisplayComponents({ type: ComponentType.TextDisplay, content: '-# this is an spotify "episode" so it\'s a little weirder' })
    } else c.addTextDisplayComponents(new TextDisplayBuilder().setContent('no active song :('));

    c.addSeparatorComponents({ type: ComponentType.Separator });
    c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `-# currently tracking: ${CONFIG.USER.nickname}` });
    c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `-# last updated: <t:${Math.floor(Date.now() / 1000)}:R>` });
    c.addSeparatorComponents({ type: ComponentType.Separator });

    c.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('recent')
                .setLabel('Last ' + RECENT_COUNT)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('toptoday')
                .setLabel('Today\'s Top 10')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('toppat')
                .setLabel('All-Time Top 20')
                .setStyle(ButtonStyle.Secondary)
        )
    )

    return [c];
}

client.on('clientReady', () => {
    if (client.user) {
        console.log(`authorized as ${client.user.tag}!`);
        setInterval(doIt, 3000);
    }
});

client.on('messageCreate', async (message) => {
    if (message.content === '!create') {
        message.delete();

        const res = await message.channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: createPanel()
        });

        fs.writeFileSync(path.join(dataDir, 'channelId.bit'), res.channel.id);
        fs.writeFileSync(path.join(dataDir, 'panelId.bit'), res.id);
    }

    if (message.content.startsWith('!whois')) {
        try {
            message.reply('ok garmin, fetching!');

            const query = message.content.replace('!whois ', '');
            const res = await spotify.search(`${query}`, { limit: 3 });
            const artistUri = res.artists.items[0].data.uri;
            const artistReq = await spotify.getArtist(artistUri);

            const artist = artistReq;

            const c = new ContainerBuilder();

            if (artist.headerImage?.data.sources[0].url)
                c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(artist.headerImage?.data.sources[0].url)));

            c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `## [${artist.profile.name}](${artist.sharingInfo.shareUrl}) (verified: ${artist.profile.verified})` })
            c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `> ${(artist.profile.biography?.text || 'no bio').slice(0, 200)}${(artist.profile.biography?.text?.length || 0) > 200 ? '...' : ''}` })
            c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `Monthly Listeners: ${artist.stats.monthlyListeners.toLocaleString()}` })
            c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: artist.stats.worldRank ? `World Rank: #${artist.stats.worldRank.toLocaleString()}` : 'World Rank: unranked (LLLL)' })
            c.addSeparatorComponents({ type: ComponentType.Separator, spacing: SeparatorSpacingSize.Small })

            const latestRelease = artist.discography.latest;
            if (latestRelease) {
                const s = new SectionBuilder()
                s.addTextDisplayComponents(new TextDisplayBuilder({ content: `### Latest Release: [${latestRelease.name}](${latestRelease.coverArt.sources[0].url})` }))
                s.addTextDisplayComponents(new TextDisplayBuilder({
                    content: [
                        `Record Label: ${latestRelease.label}`,
                        `\\# Tracks: ${latestRelease.tracks.totalCount.toLocaleString()}`,
                        `Copyright: ${latestRelease.copyright.items.map(e => e.text).join(', ')}`
                    ].join('\n')
                }))

                if (latestRelease.coverArt.sources[0].url) s.setThumbnailAccessory(new ThumbnailBuilder().setURL(latestRelease.coverArt.sources[0].url));

                c.addSectionComponents(s);
            } else c.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: 'failed to find latest album :<' });

            message.channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [c]
            })
        } catch {
            message.reply('could not find artist');
        }
    }
});

const timestampDiff = (start: number, end: number) => {
    if (start === end) return '00:03';

    const diffMs = end - start;
    const totalSeconds = Math.floor(diffMs / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    else return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

client.on('interactionCreate', (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'recent') {
        const container = new ContainerBuilder()
            .addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `### last ${RECENT_COUNT} songs` })
            .addSeparatorComponents({ type: ComponentType.Separator, spacing: SeparatorSpacingSize.Small });

        const content = historyFile.filter(e => (e.ended - e.started) > 10000).slice(-RECENT_COUNT).reverse().map((e) =>
            `- [${e.name}](${e.url}) by ${e.artists.map(e => e.name).join(', ')} for ${timestampDiff(e.started, e.ended)} (finished <t:${Math.floor(e.ended / 1000)}:R>)`
        ).join('\n') || 'no song data yet :(';

        container.addTextDisplayComponents({ type: ComponentType.TextDisplay, content });

        if (content.split('\n').length < RECENT_COUNT)
            container.addTextDisplayComponents({ type: ComponentType.TextDisplay, content: `-# there are <${RECENT_COUNT} songs in the history overall` })

        interaction.reply({ flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2], components: [container] });
    }

    if (interaction.customId === 'toptoday') {
        const container = new ContainerBuilder()
            .addTextDisplayComponents({ type: ComponentType.TextDisplay, content: '### today\'s top 10 songs' })
            .addSeparatorComponents({ type: ComponentType.Separator, spacing: SeparatorSpacingSize.Small });

        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

        interface SongPlayTimes {
            name: string;
            url: string;
            artists: { name: string, url: string }[];
            totalPlayTime: number;
        }

        const songPlayTimes: { [key: string]: SongPlayTimes } = {};

        for (const entry of historyFile) {
            if (entry.type !== 'song') continue;

            const started = entry.started;
            const ended = entry.ended;

            if (started >= startOfDay.getTime() && started < endOfDay.getTime()) {
                const playTime = ended - started;

                if (!songPlayTimes[entry.url]) songPlayTimes[entry.url] = {
                    name: entry.name,
                    url: entry.url,
                    artists: entry.artists,
                    totalPlayTime: 0
                };

                songPlayTimes[entry.url].totalPlayTime += playTime;
            }
        }

        const topSongs = Object.values(songPlayTimes)
            .sort((a, b) => b.totalPlayTime - a.totalPlayTime)
            .slice(0, 10);

        const content = topSongs.map((song) =>
            `- [${song.name}](${song.url}) by ${song.artists.map(e => e.name).join(', ')} for ${timestampDiff(0, song.totalPlayTime)}`
        ).join('\n') || 'no song data yet :(';

        container.addTextDisplayComponents({ type: ComponentType.TextDisplay, content });

        interaction.reply({ flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2], components: [container] });
    }

    if (interaction.customId === 'toppat') {
        const container = new ContainerBuilder()
            .addTextDisplayComponents({ type: ComponentType.TextDisplay, content: '### all-time top 20 songs' })
            .addSeparatorComponents({ type: ComponentType.Separator, spacing: SeparatorSpacingSize.Small });

        interface SongPlayTimes {
            name: string;
            url: string;
            artists: { name: string, url: string }[];
            totalPlayTime: number;
        }

        const songPlayTimes: { [key: string]: SongPlayTimes } = {};

        for (const entry of historyFile) {
            if (entry.type !== 'song') continue;

            const started = entry.started;
            const ended = entry.ended;

            const playTime = ended - started;

            if (!songPlayTimes[entry.url]) songPlayTimes[entry.url] = {
                name: entry.name,
                url: entry.url,
                artists: entry.artists,
                totalPlayTime: 0
            };

            songPlayTimes[entry.url].totalPlayTime += playTime;
        }

        const topSongs = Object.values(songPlayTimes)
            .sort((a, b) => b.totalPlayTime - a.totalPlayTime)
            .slice(0, 20);

        const content = topSongs.map((song) =>
            `- [${song.name}](${song.url}) by ${song.artists.map(e => e.name).join(', ')} for ${timestampDiff(0, song.totalPlayTime)}`
        ).join('\n') || 'no song data yet :(';

        container.addTextDisplayComponents({ type: ComponentType.TextDisplay, content });

        interaction.reply({ flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2], components: [container] });
    }
})

const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-');
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
}

let currentSong = '';
let ticksSinceUpdate = 0;

const doIt = async () => {
    const dataJSON = JSON.parse(fs.readFileSync(oauthFile, 'utf-8')) as DataJSON[];
    const now = Date.now();

    let target = dataJSON.find(u => u.user.display_name === CONFIG.USER.spotifyName);
    if (!target) return console.error('cannot find user with name', CONFIG.USER.spotifyName);

    if (target.token_expires < now) {
        console.log('token expired, refreshing...');

        let req = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': SPOTIFY_AUTH
            },
            body: new URLSearchParams({
                'grant_type': 'refresh_token',
                'refresh_token': target.refresh_token,
                'client_id': CONFIG.SPOTIFY.CLIENT_ID,
            })
        });
        let dat = await req.json();
        const access_token = dat.access_token;
        const token_expires = Date.now() + dat.expires_in * 1000;
        const newData = {
            ...target,
            access_token,
            token_expires
        };
        const existingData = JSON.parse(fs.readFileSync(oauthFile, 'utf-8')) as DataJSON[];
        const index = existingData.findIndex(u => u.refresh_token === target!.refresh_token);
        existingData[index] = newData;
        fs.writeFileSync(oauthFile, JSON.stringify(existingData, null, 2));
        console.log('refreshed token:', newData.access_token);
        target = newData;
    }

    if (!target.access_token) return;

    try {
        const spotifyReq = await fetch('https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${target.access_token}`
            }
        });

        const spotifyRes = spotifyReq.status === 200 ? await spotifyReq.json() : ({});

        if (spotifyReq.status === 200 && spotifyRes.is_playing) {
            const song = spotifyRes.item as SpotifyShow | SpotifySong;
            console.log('a song is playing!', song.name);

            if ('album' in song) {
                const lastSong = historyFile[historyFile.length - 1];
                if (lastSong && lastSong.url === song.external_urls.spotify && !lastSong.final)
                    historyFile[historyFile.length - 1].ended = Date.now();

                else historyFile.push({
                    type: 'song',
                    name: song.name,
                    url: song.external_urls.spotify,
                    artists: song.artists.map((a) => ({
                        name: a.name,
                        url: a.external_urls.spotify
                    })),
                    album: song.album.name,
                    albumRelease: song.album.release_date,
                    albumArt: song.album.images[0].url,
                    started: Date.now(),
                    ended: Date.now()
                });

                fs.writeFileSync(historyPath, JSON.stringify(historyFile, null, 2));
            }

            if (currentSong === song.external_urls.spotify) {
                ticksSinceUpdate++;
                if (ticksSinceUpdate === 3) ticksSinceUpdate = 0;
                else return;
            }

            currentSong = song.external_urls.spotify;
            ticksSinceUpdate = 0;

            const channelId = fs.readFileSync(path.join(dataDir, 'channelId.bit'), 'utf8');
            const panelId = fs.readFileSync(path.join(dataDir, 'panelId.bit'), 'utf8');
            const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
            if (channel && channel.isSendable()) {
                const msg = channel.messages.cache.get(panelId) || await channel.messages.fetch(panelId);
                if (msg) msg.edit({ flags: MessageFlags.IsComponentsV2, components: createPanel(song) })
                else console.log('cannot find message');
            } else console.log('cannot find channel');
        } else if (spotifyReq.status === 204 || spotifyReq.status === 200) {
            console.log('no song is currently playing.');

            if (historyFile[historyFile.length - 1]) historyFile[historyFile.length - 1].final = true;
            fs.writeFileSync(historyPath, JSON.stringify(historyFile, null, 2));

            if (currentSong === 'NONE') {
                ticksSinceUpdate++;
                if (ticksSinceUpdate === 3) ticksSinceUpdate = 0;
                else return;
            }

            currentSong = 'NONE';
            ticksSinceUpdate = 0;

            const channelId = fs.readFileSync(path.join(dataDir, 'channelId.bit'), 'utf8');
            const panelId = fs.readFileSync(path.join(dataDir, 'panelId.bit'), 'utf8');
            const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
            if (channel && channel.isSendable()) {
                const msg = channel.messages.cache.get(panelId) || await channel.messages.fetch(panelId);
                if (msg) msg.edit({ flags: MessageFlags.IsComponentsV2, components: createPanel() })
                else console.log('cannot find message');
            } else console.log('cannot find channel');
        } else {
            console.error('error fetching currently playing song:', spotifyReq.status);
        }
    } catch (err) {
        console.log('error fetching currently playing song:', err);
    }
}

client.login(Bun.env.DISCORD_TOKEN);