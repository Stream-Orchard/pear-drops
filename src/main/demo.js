// Demo mode (PD_DEMO=1): a stand-in Kick with made-up campaigns, channels, emotes
// and chat. Used by the launch tests and the trailer, so no real account, streamer
// or chatter ever appears and nothing goes to the network.
const MIN = 60_000;

// ------------------------------------------------------------------ artwork

const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' '))}`;

function avatar(name, hue) {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},85%,62%)"/><stop offset="1" stop-color="hsl(${hue + 40},80%,38%)"/></linearGradient></defs>
    <rect width="64" height="64" fill="url(#g)"/>
    <circle cx="20" cy="14" r="22" fill="#fff" opacity=".12"/>
    <text x="32" y="43" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-weight="800" font-size="28" fill="#fff">${name[0].toUpperCase()}</text></svg>`);
}

function emote(glyph, hue, shape = 'emote') {
  const body =
    shape === 'badge'
      ? `<path d="M32 4l22 8v18c0 14-9.5 24-22 30C19.5 54 10 44 10 30V12z" fill="url(#g)" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`
      : `<rect x="4" y="4" width="56" height="56" rx="18" fill="url(#g)"/>`;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},95%,66%)"/><stop offset="1" stop-color="hsl(${hue + 30},85%,42%)"/></linearGradient></defs>
    ${body}<ellipse cx="24" cy="16" rx="16" ry="8" fill="#fff" opacity=".22"/>
    <text x="32" y="${shape === 'badge' ? 40 : 43}" text-anchor="middle" font-size="${shape === 'badge' ? 24 : 30}">${glyph}</text></svg>`);
}

function categoryArt(title, glyph, hue) {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,55%)"/><stop offset="1" stop-color="hsl(${hue + 50},70%,16%)"/></linearGradient>
      <radialGradient id="r" cx=".7" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="300" height="400" fill="url(#g)"/><rect width="300" height="400" fill="url(#r)"/>
    <circle cx="240" cy="330" r="120" fill="#000" opacity=".18"/>
    <text x="150" y="215" text-anchor="middle" font-size="120">${glyph}</text>
    <text x="150" y="340" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-weight="900" font-size="34" fill="#fff" letter-spacing="-1">${title}</text></svg>`);
}

function thumbnail(glyph, hue) {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,40%)"/><stop offset="1" stop-color="hsl(${hue + 70},70%,14%)"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <circle cx="70" cy="40" r="80" fill="#fff" opacity=".08"/><circle cx="270" cy="160" r="90" fill="#000" opacity=".2"/>
    <text x="160" y="112" text-anchor="middle" font-size="64">${glyph}</text></svg>`);
}

// ------------------------------------------------------------------ the made-up world

const CHANNELS = [
  ['pixelpear', 'PixelPear', 140, '🍐'],
  ['nightowl', 'NightOwl', 250, '🦉'],
  ['arcadia', 'Arcadia', 300, '🕹️'],
  ['lofilane', 'LofiLane', 200, '🎧'],
  ['tidepool', 'Tidepool', 185, '🌊'],
  ['emberfox', 'EmberFox', 18, '🦊'],
  ['novaquinn', 'NovaQuinn', 275, '✨'],
  ['glitchgarden', 'GlitchGarden', 120, '🌱'],
  ['mossbyte', 'MossByte', 95, '🍄'],
  ['solarflair', 'SolarFlair', 40, '☀️'],
  ['kitekat', 'KiteKat', 330, '🪁'],
  ['driftwood', 'Driftwood', 30, '🪵'],
].map(([slug, username, hue, glyph], i) => ({ id: 9100 + i, slug, username, hue, glyph, avatar: avatar(username, hue) }));
const ch = (slug) => CHANNELS.find((c) => c.slug === slug);

const CATEGORIES = {
  neon: { id: 801, name: 'Neon Rush', slug: 'neon-rush', image_url: categoryArt('NEON RUSH', '🏎️', 300) },
  chat: { id: 802, name: 'Just Chatting', slug: 'just-chatting', image_url: categoryArt('CHATTING', '💬', 150) },
  sky: { id: 803, name: 'Skyforge Arena', slug: 'skyforge-arena', image_url: categoryArt('SKYFORGE', '⚒️', 20) },
  kart: { id: 804, name: 'Pixel Kart', slug: 'pixel-kart', image_url: categoryArt('PIXEL KART', '🏁', 200) },
  market: { id: 805, name: 'Market Hours', slug: 'market-hours', image_url: categoryArt('MARKETS', '📈', 120) },
};

const KICK_ORG = { id: 'org-kick', name: 'KICK', logo_url: emote('🟩', 100), restricted: false };
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

function reward(id, name, required, glyph, hue, shape) {
  return { id, name, required_units: required, image_url: emote(glyph, hue, shape), category_id: 0 };
}

function makeCampaigns() {
  return [
    {
      id: 'c-neon',
      url: 'https://kick.com/category/neon-rush',
      name: 'Neon Rush Launch Week',
      status: 'active',
      starts_at: days(-3),
      ends_at: days(1.6),
      category: CATEGORIES.neon,
      organization: KICK_ORG,
      connect_url: '',
      channels: [],
      rewards: [reward('r-neon-1', 'Hype Rocket Emote', 60, '🚀', 280), reward('r-neon-2', 'Turbo Grin Emote', 180, '😎', 310), reward('r-neon-3', 'Neon Crown Badge', 300, '👑', 45, 'badge')],
    },
    {
      id: 'c-cozy',
      url: 'https://kick.com/events/cozy-hours',
      name: 'Cozy Hours',
      status: 'active',
      starts_at: days(-5),
      ends_at: days(3),
      category: CATEGORIES.chat,
      organization: KICK_ORG,
      connect_url: '',
      channels: ['nightowl', 'lofilane', 'tidepool'].map((s) => ({ id: ch(s).id, slug: s, user: { username: ch(s).username, profile_picture: ch(s).avatar } })),
      rewards: [reward('r-cozy-1', 'Cozy Mug Emote', 30, '☕', 30), reward('r-cozy-2', 'Night Owl Badge', 120, '🦉', 260, 'badge')],
    },
    // Open to any channel, in the same category as Cozy Hours: Just Chatting holds both kinds.
    {
      id: 'c-chatter',
      name: 'Chatterbox Week',
      status: 'active',
      starts_at: days(-4),
      ends_at: days(3),
      category: CATEGORIES.chat,
      organization: KICK_ORG,
      connect_url: '',
      channels: [],
      rewards: [reward('r-chatter-1', 'Chatter Bubble Emote', 30, '💬', 160), reward('r-chatter-2', 'Gab Badge', 120, '🗣️', 120, 'badge')],
    },
    // One channel only: its queue row is that channel's.
    {
      id: 'c-solo',
      name: 'Skyforge Dev Diary',
      status: 'active',
      starts_at: days(-1),
      ends_at: days(5),
      category: CATEGORIES.sky,
      organization: { id: 'org-sky', name: 'Skyforge Studios', logo_url: emote('⚒️', 20) },
      connect_url: '',
      channels: ['tidepool'].map((s) => ({ id: ch(s).id, slug: s, user: { username: ch(s).username, profile_picture: ch(s).avatar } })),
      rewards: [reward('r-solo-1', 'Blueprint Emote', 60, '📐', 210)],
    },
    {
      id: 'c-sky',
      name: 'Skyforge Season 3',
      status: 'active',
      starts_at: days(-1),
      ends_at: days(9),
      category: CATEGORIES.sky,
      organization: { id: 'org-sky', name: 'Skyforge Studios', logo_url: emote('⚒️', 20) },
      connect_url: 'https://example.com/link-account',
      channels: [],
      rewards: [reward('r-sky-1', 'Anvil Emote', 120, '🔨', 15), reward('r-sky-2', 'Legendary Glider Skin', 240, '🪂', 200), reward('r-sky-3', 'Forgemaster Badge', 360, '🔥', 5, 'badge')],
    },
    {
      id: 'c-kart',
      name: 'Pixel Kart Grand Prix',
      status: 'active',
      starts_at: days(-6),
      ends_at: days(1),
      category: CATEGORIES.kart,
      organization: KICK_ORG,
      connect_url: '',
      channels: [],
      rewards: [reward('r-kart-1', 'Drift King Emote', 90, '🏁', 190)],
    },
    {
      id: 'c-market',
      name: 'Closing Bell Cup',
      status: 'active',
      starts_at: days(-2),
      ends_at: days(6),
      category: CATEGORIES.market,
      organization: KICK_ORG,
      connect_url: '',
      channels: ['driftwood', 'solarflair'].map((s) => ({ id: ch(s).id, slug: s, user: { username: ch(s).username, profile_picture: ch(s).avatar } })),
      rewards: [reward('r-market-1', 'Bull Run Emote', 60, '🐂', 120), reward('r-market-2', 'Diamond Hands Badge', 240, '💎', 190, 'badge')],
    },
    // Announced, not started yet (Kick lists these as "upcoming"): the Coming soon card.
    {
      id: 'c-kart-night',
      url: 'https://kick.com/events/pixel-kart-night-cup',
      created_at: days(-2),
      name: 'Pixel Kart Night Cup',
      status: 'upcoming',
      starts_at: days(0.3),
      ends_at: days(7),
      category: CATEGORIES.kart,
      organization: KICK_ORG,
      connect_url: '',
      channels: [],
      rewards: [reward('r-night-1', 'Midnight Lap Emote', 90, '🌙', 230), reward('r-night-2', 'Night Cup Badge', 240, '🏆', 50, 'badge')],
    },
    {
      id: 'c-sky-s4',
      url: 'https://kick.com/category/skyforge-arena',
      created_at: days(-0.4),
      name: 'Skyforge Season 4',
      status: 'upcoming',
      starts_at: days(4.2),
      ends_at: days(18),
      category: CATEGORIES.sky,
      organization: KICK_ORG,
      connect_url: '',
      channels: [],
      rewards: [reward('r-s4-1', 'Anvil Emote', 60, '🔨', 25), reward('r-s4-2', 'Forge Spark Emote', 180, '✨', 45), reward('r-s4-3', 'Season 4 Badge', 360, '🛡️', 200, 'badge')],
    },
  ];
}

const LIVE = {
  [CATEGORIES.neon.id]: [
    ['pixelpear', 'Ranked grind to Neon Legend — drops on! 🏎️', 4210],
    ['arcadia', 'Speedrun attempts + viewer races', 2380],
    ['novaquinn', 'chill laps & good vibes ✨', 1220],
    ['emberfox', 'NEW TRACK just dropped — first look', 860],
    ['kitekat', 'Learning every shortcut', 310],
    ['glitchgarden', 'Neon Rush but every crash = new car', 184],
  ],
  [CATEGORIES.chat.id]: [
    ['nightowl', 'late night chats & tea ☕', 3120],
    ['lofilane', 'lofi + chatting, come hang 🎧', 1470],
    ['mossbyte', 'reading your stories', 240],
  ],
  [CATEGORIES.sky.id]: [['tidepool', 'Skyforge S3 day one!', 990]],
  [CATEGORIES.market.id]: [],
};

// ------------------------------------------------------------------ the daily reward's cards

const RARITY_COLOUR = { common: '#a0a0a0', uncommon: '#23bf46', rare: '#00b5e0', epic: '#fd4547', legendary: '#f7a910', mythic: '#ffa0ec' };

/** A made-up collectible card, framed like Kick's: its type on a tab, the emote, its name. */
function collectibleCard(name, glyph, hue, rarity, type) {
  const c = RARITY_COLOUR[rarity];
  const frame = rarity === 'mythic' ? 'url(#m)' : c;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},90%,62%)"/><stop offset="1" stop-color="hsl(${hue + 35},80%,36%)"/></linearGradient>
      <linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#80fcff"/><stop offset=".5" stop-color="#fcf2aa"/><stop offset="1" stop-color="#ffa0ec"/></linearGradient>
      <radialGradient id="b" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="#0d1015" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="3" y="3" width="114" height="154" rx="11" fill="#0f1217" stroke="${frame}" stroke-width="3"/>
    <rect x="3" y="3" width="114" height="154" rx="11" fill="url(#b)"/>
    <path d="M14 30h92v74l-46 22-46-22z" fill="#161b22" stroke="${frame}" stroke-opacity=".75" stroke-width="1.5"/>
    <path d="M40 3h40l-5 11H45z" fill="${frame}"/>
    <text x="60" y="11.5" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-weight="900" font-size="6.5" letter-spacing="1" fill="#0b0d10">${type.toUpperCase()}</text>
    ${type === 'badge' ? '<path d="M60 40l22 8v18c0 13-9.5 22-22 28-12.5-6-22-15-22-28V48z" fill="url(#g)" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>' : '<rect x="36" y="42" width="48" height="48" rx="15" fill="url(#g)"/>'}
    <ellipse cx="52" cy="50" rx="13" ry="6" fill="#fff" opacity=".2"/>
    <text x="60" y="${type === 'badge' ? 77 : 76}" text-anchor="middle" font-size="${type === 'badge' ? 22 : 27}">${glyph}</text>
    <text x="60" y="143" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-weight="900" font-size="10.5" letter-spacing=".6" fill="#fff">${name.toUpperCase()}</text>
  </svg>`);
}

// 72 made-up cards: [rarity, names, glyphs].
const CARD_SETS = [
  ['common', 'Snack Bonk Wave Nod Yawn Clap Shrug Blink Sip Peek Zzz Lol Hmm Yay Oops Ok Pog Hi Gg Cozy Chill Wow Nice Cry Laugh Wink Sus Bruh Hype Love Rage Cool Bean Pear Leaf Drop', '🍪 🔨 👋 🙂 🥱 👏 🤷 😳 🧃 👀 😴 😂 🤔 🥳 😬 👌 😮 🙋 🤝 ☕ 🧊 🤩 👍 😢 🤣 😉 🕵️ 😐 🔥 💚 😡 😎 🫘 🍐 🍃 💧'],
  ['uncommon', 'Turbo Glow Zen Chef Bolt Rocket Pixel Neon Comet Jelly Mochi Disco Tidal Ember Frost Volt Orbit Prism', '🏎️ ✨ 🧘 👨‍🍳 ⚡ 🚀 👾 💡 ☄️ 🪼 🍡 🪩 🌊 🔥 ❄️ 🔋 🪐 🔺'],
  ['rare', 'Big_Brain Pear_King Galaxy Dragon Wizard Phantom Kraken Cyber Aurora Nova', '🧠 👑 🌌 🐉 🧙 👻 🐙 🤖 🌈 🌟'],
  ['epic', 'Inferno Titan Eclipse Hydra Storm', '🌋 🗿 🌘 🐍 ⛈️'],
  ['legendary', 'Golden_Pear Crown', '🍐 👑'],
  ['mythic', 'Starfall', '💫'],
];
const HUES = { common: 210, uncommon: 120, rare: 190, epic: 0, legendary: 40, mythic: 300 };
function makeCards() {
  return CARD_SETS.flatMap(([rarity, names, glyphs]) => {
    const g = glyphs.split(' ');
    return names.split(' ').map((n, i) => {
      const type = (rarity === 'legendary' && i === 1) || i % 13 === 7 ? 'badge' : 'emote';
      const id = `card-${rarity}-${i}`;
      return { id, rarity, type, card_url: collectibleCard(n.replace('_', ' '), g[i], (HUES[rarity] + i * 23) % 360, rarity, type) };
    });
  });
}
// Which made-up cards the demo account owns at the start.
const OWNED = { common: (i) => i % 3 !== 2, uncommon: (i) => i % 2 === 0, rare: (i) => i % 4 === 1, epic: (i) => i % 5 === 3, legendary: () => false, mythic: () => false };
const DROP_TABLE = [
  ['common', 550000],
  ['uncommon', 280000],
  ['rare', 120000],
  ['epic', 47000],
  ['legendary', 2995],
  ['mythic', 5],
];

// ------------------------------------------------------------------ fake API

class DemoApi {
  constructor() {
    this.loggedIn = !!process.env.PD_DEMO_SIGNED_IN;
    this.rawCampaigns = makeCampaigns();
    this.units = { 'c-neon': 148, 'c-cozy': 34, 'c-chatter': 20, 'c-solo': 0, 'c-sky': 12, 'c-kart': 92, 'c-market': 0, 'c-kart-night': 0, 'c-sky-s4': 0 };
    this.claimed = new Set(['r-neon-1', 'r-cozy-1', 'r-kart-1']);
    this.pending = 0; // credit units waiting for the next progress read
    this.watching = null;
    this.conflict = false;
    this.offline = new Set(); // stand-in channels taken offline by a test or the trailer
    this.brokenThumbs = new Set(); // channels whose thumbnail won't load (a stream that just started)
    this.follows = new Set(['arcadia', 'nightowl', 'emberfox']);
    // The daily reward: 37 of the hour watched, a 12-day streak, about half the cards.
    this.cards = makeCards();
    this.owned = new Set(this.cards.filter((c) => OWNED[c.rarity](Number(c.id.split('-').pop()))).map((c) => c.id));
    this.daily = { id: 'daily-demo', minutes: 37, status: 'in_progress' };
    this.welcome = { id: 'welcome-demo', status: 'in_progress' };
    this.levelData = { level: 42, progress_xp: 340, xp_to_next_level: 260 };
    this.streakDays = 12;
    this.nextWinner = null; // a test or the trailer can pick the card the next claim wins
  }

  async hasLogin() {
    return this.loggedIn;
  }
  async me() {
    return this.loggedIn ? { id: 4242, username: 'pearfarmer', profilepic: avatar('pearfarmer', 95) } : null;
  }
  async myEmotes() {
    // The stand-in "unlocked" emotes: claimed drop rewards, served as data images.
    return [
      { id: 'demo-rocket', name: 'HypeRocket', animated: true, url: emote('🚀', 280) },
      { id: 'demo-mug', name: 'CozyMug', animated: false, url: emote('☕', 30) },
    ];
  }

  async followedSlugs() {
    return new Set(this.follows);
  }
  async follow(slug) {
    if (!this.loggedIn) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    this.follows.add(slug);
    return {};
  }
  async unfollow(slug) {
    this.follows.delete(slug);
    return null;
  }
  async campaigns() {
    return this.rawCampaigns;
  }

  async progress() {
    return this.rawCampaigns
      .filter((c) => this.units[c.id] > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        progress_units: this.units[c.id],
        rewards: c.rewards.map((r) => ({
          id: r.id,
          claimed: this.claimed.has(r.id),
          progress: Math.min(1, this.units[c.id] / r.required_units),
          required_units: r.required_units,
        })),
      }));
  }

  async campaignsForLivestream(channelId, categoryId) {
    return this.rawCampaigns.filter((c) => c.category.id === categoryId && (!c.channels.length || c.channels.some((x) => x.id === channelId)));
  }

  async claim(campaignId, rewardId) {
    // A test or the trailer can have the stand-in refuse claims, with the body Kick sends.
    if (this.refuseClaims) throw Object.assign(new Error('HTTP 400'), { status: 400, body: this.refuseClaims });
    this.claimed.add(rewardId);
    return { message: 'Success' };
  }

  // ---- The daily reward, shaped like Kick's replies ({ data, message }) ----
  async dailyChallenges(query) {
    if (!this.loggedIn) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const window = { starts_at: day.toISOString(), ends_at: new Date(day.getTime() + 86_400_000).toISOString() };
    const table = DROP_TABLE.map(([rarity, weighting]) => ({ rarity, weighting }));
    // Demo mode never goes to the network: no Kick videos, so the app draws its own crate.
    if (query?.recurrence === 'one_off')
      return { data: [{ id: this.welcome.id, name: 'Welcome Reward', recurrence: 'one_off', status: this.welcome.status, featured: false, condition: { type: 'onboarding_completed', progress: 0, threshold: 1 }, drop_table: table, animations: null }], message: 'success' };
    const d = this.daily;
    return {
      data: [{ id: d.id, name: 'Daily Reward', recurrence: 'daily', status: d.status, featured: false, window, condition: { type: 'watch_time_minutes', progress: d.minutes, threshold: 60 }, drop_table: table, animations: null }],
      message: 'success',
    };
  }

  async collectibles() {
    return { data: this.cards.map((c) => ({ ...c, owned: this.owned.has(c.id) })), message: 'success' };
  }

  async level() {
    return { data: { ...this.levelData, total_xp: 98_000, badge: null }, message: 'success' };
  }

  async streak() {
    return { data: { length_days: this.streakDays }, message: 'success' };
  }

  /** The stand-in claim: Kick's reel (its 24 tiles), a winner picked by the odds, a duplicate's level progress. */
  async claimDaily(id) {
    const target = id === this.welcome.id ? this.welcome : this.daily;
    if (target.status !== 'claimable') throw Object.assign(new Error('HTTP 400'), { status: 400, body: { message: 'Challenge not claimable' } });
    let roll = Math.random() * 1_000_000;
    const rarity = DROP_TABLE.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'common';
    const pool = this.cards.filter((c) => c.rarity === rarity);
    const winner = this.cards.find((c) => c.id === this.nextWinner) ?? pool[Math.floor(Math.random() * pool.length)];
    this.nextWinner = null;
    const duplicate = this.owned.has(winner.id);
    this.owned.add(winner.id);
    target.status = 'claimed';
    if (target === this.daily) this.streakDays += 1;
    if (duplicate) this.levelData = { ...this.levelData, progress_xp: this.levelData.progress_xp + 12 };
    const reel = [...this.cards].sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % 3 === 0).slice(0, 24);
    return {
      data: {
        reveal_type: 'roulette',
        roulette: reel.map((c) => ({ id: c.id, item_url: c.card_url })),
        winner: { id: winner.id, rarity: winner.rarity, type: winner.type, card_url: winner.card_url },
        consolation: duplicate ? { watch_time_minutes: 12, next_level_badge: { metadata: { level: this.levelData.level + 1 } } } : null,
      },
      message: 'success',
    };
  }

  async livestreams(categoryId) {
    return (LIVE[categoryId] ?? []).filter(([slug]) => !this.offline.has(slug)).map(([slug, title, viewers], i) => {
      const c = ch(slug);
      return {
        id: `ls-${slug}`,
        title,
        viewer_count: viewers,
        thumbnail: { src: this.brokenThumbs.has(slug) ? 'data:image/webp;base64,AAAA' : thumbnail(c.glyph, c.hue) },
        start_time: new Date(Date.now() - (40 + i * 25) * MIN).toISOString(),
        channel: { id: c.id, slug, username: c.username, profile_pic: c.avatar },
        category: { id: categoryId },
        language: 'en',
        is_mature: false,
      };
    });
  }

  async channelInfo(slug) {
    const entry = Object.entries(LIVE).find(([, list]) => list.some(([s]) => s === slug));
    if (!entry || this.offline.has(slug)) return { slug, is_banned: false, livestream: null };
    const [catId, list] = entry;
    const [, title, viewers] = list.find(([s]) => s === slug);
    const c = ch(slug);
    return { slug, is_banned: false, livestream: { is_live: true, session_title: title, viewer_count: viewers, categories: [{ id: Number(catId) }], thumbnail: { src: thumbnail(c.glyph, c.hue) } } };
  }

  /** As the real one: the pages using the login close first (closePages). */
  async signOut({ closePages } = {}) {
    await closePages?.();
    this.loggedIn = false;
  }

  /** Kick stops listing a campaign (it ended, or was taken down). */
  endCampaign(id) {
    const c = this.rawCampaigns.find((x) => x.id === id);
    if (!c) return;
    this.ended = { ...(this.ended ?? {}), [id]: c };
    this.rawCampaigns = this.rawCampaigns.filter((x) => x.id !== id);
  }

  /** Kick lists an ended campaign again, with a new end date. */
  relistCampaign(id, daysLeft) {
    const c = this.ended?.[id];
    if (!c) return;
    delete this.ended[id];
    this.rawCampaigns.push({ ...c, status: 'active', ends_at: days(daysLeft) });
  }

  /** The stand-in server: credit the campaigns the watched channel counts for. */
  creditWatch(slug, amount = 2) {
    if (this.conflict) return;
    // Watch time counts toward the daily reward, on any channel.
    if (this.daily.status === 'in_progress') {
      this.daily.minutes = Math.min(60, this.daily.minutes + amount);
      if (this.daily.minutes >= 60) this.daily.status = 'claimable';
    }
    const c = ch(slug);
    const live = Object.entries(LIVE).find(([, list]) => list.some(([s]) => s === slug));
    if (!c || !live) return;
    for (const camp of this.rawCampaigns) {
      if (camp.category.id !== Number(live[0])) continue;
      // Announced drops (Coming soon) don't count until they start.
      if (new Date(camp.starts_at).getTime() > Date.now()) continue;
      if (camp.channels.length && !camp.channels.some((x) => x.id === c.id)) continue;
      this.units[camp.id] += amount;
    }
  }
}

// ------------------------------------------------------------------ stand-in stream page

const CHATTERS = [
  ['bytebandit', 340],
  ['mapleleaf', 25],
  ['quietstorm', 200],
  ['zigzag', 90],
  ['honeybee', 48],
  ['orbit', 180],
  ['velvet', 300],
  ['comet', 260],
];
const LINES = ['LETS GO', 'that turn was clean', 'gg', 'drops are live?', 'first time here, love the vibe', 'W stream', 'hype!!', 'how long till the badge?', 'POG', 'lol', 'that was insane', 'hi chat', 'clip it'];
const GLYPHS = ['🚀', '😎', '🔥', '🏁', '☕', '👑', '✨'];

/** mode: 'page' (channel page), 'player' (embed player only) or 'chat' (popout chat only). */
function streamPage(slug, eventSeconds, mode = 'page') {
  const c = ch(slug) ?? CHANNELS[0];
  const chat = JSON.stringify({ chatters: CHATTERS, lines: LINES, glyphs: GLYPHS.map((g, i) => emote(g, i * 50)) });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${c.username}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#0b0e0f;color:#e8ecef;font:14px -apple-system,Segoe UI,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
  .bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#121618;border-bottom:1px solid #1e2427}
  .bar img{width:34px;height:34px;border-radius:50%}.bar b{font-size:15px}.live{background:#e8384f;color:#fff;font-weight:800;font-size:11px;padding:2px 6px;border-radius:4px}
  video{width:100%;aspect-ratio:16/9;background:#000;display:block}
  .chat{flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;padding:8px 12px;gap:4px}
  .msg{line-height:1.45;animation:in .25s ease}.msg b{margin-right:6px}.msg img{width:22px;height:22px;vertical-align:-6px;margin:0 2px}
  @keyframes in{from{opacity:0;transform:translateY(6px)}}
  .box{margin:8px 12px 12px;padding:10px 12px;border-radius:8px;background:#1a1f22;color:#6b757b}
  .m-player .bar,.m-player .chat,.m-player .box{display:none}.m-player video{height:100vh;aspect-ratio:auto;object-fit:cover}
  .m-chat .bar,.m-chat video{display:none}
  </style></head><body class="m-${mode}">
  <div class="bar"><img src="${c.avatar}"><b>${c.username}</b><span class="live">LIVE</span></div>
  <video autoplay muted playsinline></video>
  <div class="chat" id="chat"></div><div class="box">Send a message</div>
  <script>
  const C=${chat};const hue=${c.hue};const glyph=${JSON.stringify(c.glyph)};const name=${JSON.stringify(c.username)};
  const cv=document.createElement('canvas');cv.width=960;cv.height=540;const g=cv.getContext('2d');let t=0;
  let frozen=false,ended=false;
  function draw(){if(frozen){requestAnimationFrame(draw);return}if(ended){g.fillStyle='#0b0d10';g.fillRect(0,0,960,540);g.fillStyle='#8a929c';g.font='bold 34px -apple-system,sans-serif';g.textAlign='center';g.fillText(name+' is offline',480,280);requestAnimationFrame(draw);return}t+=1/30;const w=960,h=540;const gr=g.createLinearGradient(0,0,w,h);gr.addColorStop(0,'hsl('+(hue+Math.sin(t/3)*20)+',70%,32%)');gr.addColorStop(1,'hsl('+(hue+80)+',70%,10%)');g.fillStyle=gr;g.fillRect(0,0,w,h);
  for(let i=0;i<14;i++){const x=(i*97+t*60*(1+i%3))%(w+200)-100,y=h*0.55+Math.sin(t*1.5+i)*140;g.globalAlpha=.12;g.fillStyle='#fff';g.beginPath();g.arc(x,y,30+i*4,0,7);g.fill();}
  g.globalAlpha=1;g.font='170px serif';g.textAlign='center';g.fillText(glyph,w/2+Math.sin(t)*120,h/2+40+Math.cos(t*1.3)*30);
  g.fillStyle='rgba(0,0,0,.45)';g.fillRect(24,h-74,330,50);g.fillStyle='#fff';g.font='bold 26px -apple-system,sans-serif';g.textAlign='left';g.fillText(name+' · live',42,h-40);
  requestAnimationFrame(draw)}draw();
  const v=document.querySelector('video');v.srcObject=cv.captureStream(30);v.play().catch(()=>{});
  const chatEl=document.getElementById('chat');
  function say(){const [n,h]=C.chatters[Math.random()*C.chatters.length|0];let text=C.lines[Math.random()*C.lines.length|0];
  const d=document.createElement('div');d.className='msg';d.innerHTML='<b style="color:hsl('+h+',80%,65%)">'+n+'</b>'+text+(Math.random()<.5?' <img src="'+C.glyphs[Math.random()*C.glyphs.length|0]+'">':'');
  chatEl.appendChild(d);while(chatEl.children.length>40)chatEl.firstChild.remove();setTimeout(say,500+Math.random()*1400)}say();
  // Kick's player reports watch time about every two minutes.
  const fire=()=>window.postMessage({__pd:true,kind:'watch-event'},location.origin);
  if(${JSON.stringify(mode)}!=='chat'){window.__demoWatchEvent=fire;setTimeout(fire,4000);setInterval(fire,${eventSeconds * 1000});}
  // For tests and the trailer: the picture freezes (the video says it plays, but doesn't move), the
  // stream ends (the video's ended event), or Kick's realtime socket says something about the stream.
  window.__demoFreeze=(on)=>{frozen=on;if(on){const at=v.currentTime;Object.defineProperty(v,'currentTime',{configurable:true,get:()=>at})}else delete v.currentTime};
  window.__demoEnd=()=>{ended=true;v.dispatchEvent(new Event('ended'))};
  window.__demoRealtime=(event,target)=>window.postMessage({__pd:true,kind:'realtime',event,target},location.origin);
  </script></body></html>`;
}

/** Serves the stand-in pages for every kick.com address in the demo session. */
function installStage(ses, { eventSeconds = 120 } = {}) {
  ses.protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (!url.hostname.endsWith('kick.com')) return new Response('', { status: 404 });
    const parts = url.pathname.split('/').filter(Boolean);
    const mode = url.hostname === 'player.kick.com' ? 'player' : parts[0] === 'popout' ? 'chat' : 'page';
    const slug = (mode === 'chat' ? parts[1] : parts[0]) || 'pixelpear';
    return new Response(streamPage(slug, eventSeconds, mode), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}

/**
 * Fills the farmer with an hour and a half of believable history, so charts,
 * rates and forecasts look like a long-running session.
 */
function seedHistory(farmer, api) {
  const cur = farmer.current;
  if (!cur) return;
  const now = Date.now();
  const watched = 48 * MIN;
  const start = now - 96 * MIN;
  const camp = cur.campaignIds[0];
  const endUnits = api.units[camp];
  farmer.samples = [];
  farmer.timeline = [];
  for (let t = start, i = 0; t <= now; t += MIN, i++) {
    const elapsed = (t - start) / MIN;
    const units = {};
    for (const [id, u] of Object.entries(api.units)) units[id] = u;
    units[camp] = Math.max(0, Math.round(endUnits - (96 - elapsed) * 0.98));
    farmer.samples.push({ t, units });
    if (i % 2 === 0) farmer.timeline.push({ t: t - 20_000, type: 'sent' });
    if (i % 2 === 0 && i > 0) farmer.timeline.push({ t, type: 'credit', campaignId: camp, delta: 2 });
  }
  farmer.timeline.push({ t: start + 22 * MIN, type: 'claim', name: 'Hype Rocket Emote' });
  farmer.timeline.push({ t: now - watched, type: 'switch', name: cur.username });
  farmer.timeline.sort((a, b) => a.t - b.t);
  cur.startedWatchingAt = now - watched;
  cur.campaignSince = Object.fromEntries(cur.campaignIds.map((id) => [id, now - watched]));
  cur.lastProgressAt = now - 70_000;
  farmer.lastCreditAt = cur.lastProgressAt;
  farmer.stats.sessionStart = start;
  farmer.stats.watchMs = 94 * MIN;
  farmer.stats.watchTickAt = now;
  farmer.stats.earned = 92;
  farmer.stats.claims = 1;
  farmer.stats.eventsSent = 47;
  farmer.stats.switches = 2;
  for (const [id, u] of Object.entries(api.units)) farmer.prevUnits.set(id, u);
  farmer.log = [
    { t: start, level: 'info', text: 'Farmer started' },
    { t: start + 30_000, level: 'switch', text: 'Watching Arcadia for Neon Rush' },
    { t: start + 22 * MIN, level: 'claim', text: 'Claimed Hype Rocket Emote (Neon Rush Launch Week)' },
    { t: now - watched - 60_000, level: 'warn', text: 'No progress for 20 min, reloading Arcadia' },
    { t: now - watched, level: 'switch', text: `Stream went offline, leaving Arcadia` },
    { t: now - watched + 2000, level: 'switch', text: `Watching ${cur.username} for ${cur.categoryName}` },
    ...[8, 6, 4, 2].map((m) => ({ t: now - m * MIN, level: 'credit', text: `+2 min on Neon Rush Launch Week (${endUnits - m + 2} total)` })),
  ];
  farmer.changed();
}

/**
 * A week of made-up history (sessions, credits, claims, stalls, a conflict
 * evening…) ending at the stand-in's current progress, for the History view.
 */
function seedHistoryLog(history, api, now = Date.now()) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const camps = makeCampaigns();
  const camp = (id) => camps.find((c) => c.id === id);
  const plan = [
    // [days ago, start hour, minutes, channel, campaign, extras]
    [6, 19, 80, 'emberfox', 'c-kart', {}],
    [6, 21, 40, 'kitekat', 'c-kart', { claim: 'r-kart-1' }],
    [5, 18, 44, 'nightowl', 'c-cozy', { claim: 'r-cozy-1' }],
    [5, 21, 40, 'lofilane', 'c-cozy', { stall: true }],
    [4, 13, 24, 'tidepool', 'c-sky', { offline: true }],
    [4, 20, 50, 'pixelpear', 'c-neon', { claim: 'r-neon-1' }],
    [3, 19, 60, 'arcadia', 'c-neon', { conflict: true }],
    [2, 9, 20, 'novaquinn', 'c-neon', { crash: true }],
    [2, 20, 24, 'pixelpear', 'c-neon', {}],
    [1, 17, 40, 'emberfox', 'c-neon', { stall: true }],
    [1, 22, 10, 'arcadia', 'c-neon', {}],
    [0, 0.5, 0, 'arcadia', 'c-neon', { open: true }],
  ];
  // Which 2-minute marks of a session get credit (a conflict or a stall eats some).
  const earns = (minutes, x, m) => !(x.conflict && m > minutes * 0.3 && m < minutes * 0.95) && !(x.stall && m > minutes * 0.5 && m < minutes * 0.5 + 22);
  // Running totals end exactly where the stand-in's progress is now.
  const credits = {};
  plan.forEach(([, , minutes, , id, x]) => {
    for (let m = 2; m <= minutes; m += 2) if (earns(minutes, x, m)) credits[id] = (credits[id] ?? 0) + 2;
  });
  const units = Object.fromEntries(Object.keys(credits).map((id) => [id, Math.max(0, api.units[id] - credits[id])]));

  const events = [];
  const add = (t, type, data) => events.push({ t, type, ...data });
  const ctx = (c) => ({ campaignId: c.id, campaign: c.name, categoryId: c.category.id, category: c.category.name });
  plan.forEach(([daysAgo, hour, minutes, slug, id, x], i) => {
    if (x.open) return;
    const c = camp(id);
    const channel = CHANNELS.find((k) => k.slug === slug);
    const day = new Date(now - daysAgo * 86_400_000);
    day.setHours(Math.floor(hour), Math.round((hour % 1) * 60) + Math.floor(rand() * 20), 0, 0);
    const start = Math.min(day.getTime(), now - 3 * 3600_000);
    const session = `demo-${i}`;
    const stream = { session, slug, channel: channel.username, avatar: channel.avatar, categoryId: c.category.id, category: c.category.name, campaignIds: [c.id] };
    // The stream's title then: its title now, if it's in the stand-in's live list.
    const title = Object.values(LIVE).flat().find(([s]) => s === slug)?.[1] ?? `${channel.username} live`;
    add(start, 'watch-start', { ...stream, campaigns: [c.name], title, text: `Watching ${channel.username} for ${c.category.name}` });
    let credited = 0;
    for (let m = 2; m <= minutes; m += 2) {
      const t = start + m * MIN + Math.floor(rand() * 20_000);
      add(t - 30_000, 'heartbeat', {}); // dropped below: only credits are kept
      if (!earns(minutes, x, m) && x.conflict) {
        if (m % 6 === 0) add(t, 'credit-elsewhere', { ...ctx(camp('c-cozy')), delta: 2, text: '+2 min credited to a stream this app isn\'t watching' });
        if (m === Math.round(minutes * 0.3 / 2) * 2 + 6) add(t, 'conflict', { ...stream, events: 3, minutes: 6, text: '3 watch events with no credit: another Kick stream on your account is taking it' });
        continue;
      }
      if (!earns(minutes, x, m)) {
        if (m === Math.round(minutes * 0.25) * 2 + 20) {
          add(t, 'stall', { ...stream, minutes: 20, action: 'reload', text: `No progress for 20 min on ${channel.username}` });
          add(t + 1000, 'reload', { ...stream, reason: 'No progress for 20 min', text: `Reloaded ${channel.username}: No progress for 20 min` });
        }
        continue;
      }
      units[id] += 2;
      credited += 2;
      add(t, 'credit', { ...ctx(c), ...stream, delta: 2, units: units[id], text: `+2 min (${units[id]} total)` });
      for (const r of c.rewards) {
        if (units[id] - 2 < r.required_units && units[id] >= r.required_units) {
          add(t + 2000, 'unlock', { ...ctx(c), rewardId: r.id, reward: r.name, rewardImage: r.image_url, required: r.required_units, units: units[id], text: `${r.name} unlocked at ${r.required_units} min` });
          if (x.claim === r.id || api.claimed.has(r.id)) add(t + 9000, 'claim', { ...ctx(c), rewardId: r.id, reward: r.name, rewardImage: r.image_url, required: r.required_units, text: `Claimed ${r.name}` });
        }
      }
      if (x.crash && m === 20) add(t + 5000, 'crash', { ...stream, reason: 'page froze', text: `Player problem on ${channel.username}: page froze` });
    }
    const end = start + minutes * MIN;
    const reason = x.offline ? 'Stream went offline' : i === plan.length - 2 ? 'App closed or signed out' : pick(['Stream went offline', 'Paused', 'Drops for this stream are done', 'Skipped by you']);
    if (x.offline || reason === 'Stream went offline') add(end - 500, 'offline', { ...stream, text: `${channel.username}: Stream went offline` });
    add(end, 'watch-end', { ...stream, reason, minutes, credited, text: `Left ${channel.username} after ${minutes} min (+${credited} credited): ${reason}` });
    if (id === 'c-kart' && x.claim) {
      add(end + 1000, 'campaign-complete', { ...ctx(c), text: `Every emote and badge in ${c.name} collected` });
      add(end + 2000, 'category-complete', { categoryId: c.category.id, category: c.category.name, text: `${c.category.name} complete, moving on` });
    }
    if (reason === 'Paused') add(end + 1000, 'pause', { text: 'Paused' });
  });
  add(now - 7 * 86_400_000, 'login', { text: 'Signed in as pearfarmer' });
  add(now - 7 * 86_400_000 + 5000, 'start', { text: 'Farming started' });
  add(now - 2 * 86_400_000 - 3600_000 * 5, 'wake', { text: 'Computer woke from sleep, reloaded the stream' });
  history.addMany(events.filter((e) => e.type !== 'heartbeat' && e.t < now - 60_000));
}

/**
 * Drops that ended before the demo starts, as the archive remembers them: one
 * finished, one that ran out with rewards left, and one Kick took down early.
 */
function pastCampaigns(now) {
  const at = (d) => new Date(now + d * 86_400_000).toISOString();
  const frost = { id: 806, name: 'Frost Rally', slug: 'frost-rally', image_url: categoryArt('FROST RALLY', '❄️', 195) };
  const retro = { id: 807, name: 'Retro Arcade', slug: 'retro-arcade', image_url: categoryArt('RETRO', '👾', 265) };
  const camp = (id, name, category, start, end, rewards) => ({ id, name, status: 'active', starts_at: at(start), ends_at: at(end), category, organization: KICK_ORG, channels: [], rewards });
  return {
    campaigns: [
      // With its About page, as Kick gives most drops: the Done card shows Details beside History.
      { ...camp('c-frost', 'Frostbite Rally Weekend', frost, -9, -4, [reward('r-frost-1', 'Snowdrift Emote', 60, '⛄', 195), reward('r-frost-2', 'Ice Crown Badge', 180, '🧊', 205, 'badge')]), url: 'https://kick.com/category/frostbite-rally' },
      camp('c-retro', 'Retro Arcade Week', retro, -8, -2, [reward('r-retro-1', 'Pixel Heart Emote', 45, '💜', 280), reward('r-retro-2', 'Coin Op Emote', 150, '🪙', 45), reward('r-retro-3', 'High Score Badge', 300, '🏆', 50, 'badge')]),
      camp('c-melt', 'Meltdown Mini-Event', CATEGORIES.neon, -2, 3, [reward('r-melt-1', 'Lava Lamp Emote', 90, '🌋', 15)]),
    ],
    progress: [
      { id: 'c-frost', progress_units: 180, rewards: [{ id: 'r-frost-1', claimed: true }, { id: 'r-frost-2', claimed: true }] },
      { id: 'c-retro', progress_units: 96, rewards: [{ id: 'r-retro-1', claimed: true }, { id: 'r-retro-2', claimed: false }, { id: 'r-retro-3', claimed: false }] },
      { id: 'c-melt', progress_units: 22, rewards: [{ id: 'r-melt-1', claimed: false }] },
    ],
  };
}

/** Fills an empty archive with the demo's past drops. */
function seedArchive(archive, now = Date.now()) {
  if (archive.entries().length) return;
  const { campaigns, progress } = pastCampaigns(now);
  const day = 86_400_000;
  archive.update(campaigns, progress, now - 9 * day);
  archive.campaigns['c-frost'].claimedAt = { 'r-frost-1': now - 7 * day, 'r-frost-2': now - 5 * day };
  // Seen for the last time as each one ended (or was taken down).
  archive.update(campaigns.slice(1), progress, now - 4 * day);
  archive.update(campaigns.slice(2), progress, now - 2 * day);
  archive.update([], [], now - 1 * day);
}

function createDemo() {
  const api = new DemoApi();
  return {
    api,
    partition: 'pd-demo',
    installStage,
    seedHistory,
    seedHistoryLog: (history) => seedHistoryLog(history, api),
    seedArchive,
  };
}

module.exports = { createDemo, streamPage, CHANNELS, CATEGORIES };
