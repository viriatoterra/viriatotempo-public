import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateShareImage } from './share-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());

// Servir PWA (archivos estáticos) ANTES de todo — para que fuentes, JS, etc. se sirvan directamente
const webDist = path.join(__dirname, 'web');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
}

app.use(express.json({
  limit: '50mb',
  // Guardar el buffer crudo del /sync para escribirlo a disco tal cual,
  // sin re-stringificar 37MB (evita un pico extra de memoria en la instancia)
  verify: (req, res, buf) => {
    if (req.path === '/sync') req.rawBody = buf;
  },
}));

// ============ DATA ============
let events = [];
let participants = [];
let results = [];
let splits = [];
let laps = [];

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('⚠️ data.json no encontrado — datos vacíos');
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    events = data.events || [];
    participants = data.participants || [];
    results = data.results || [];
    splits = data.splits || [];
    laps = data.laps || [];
    console.log(`📂 Datos cargados: ${events.length} eventos, ${participants.length} participantes, ${results.length} resultados, ${splits.length} splits, ${laps.length} laps`);
  } catch (err) {
    console.error('❌ Error cargando data.json:', err.message);
  }
}

loadData();

// ============ SYNC ENDPOINT (protegido con token) ============
const SYNC_TOKEN = process.env.SYNC_TOKEN || 'viriato-sync-2026';

app.post('/sync', (req, res) => {
  const token = req.headers['x-sync-token'];
  if (token !== SYNC_TOKEN) {
    return res.status(401).json({ message: 'Token inválido' });
  }
  try {
    const data = req.body;
    if (!data.events || !data.participants || !data.results) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }
    events = data.events;
    participants = data.participants;
    results = data.results;
    splits = data.splits || [];
    laps = data.laps || [];

    // Guardar a disco para persistir entre reinicios de Render.
    // Se escribe el buffer crudo recibido (sin JSON.stringify) para no duplicar
    // ~37MB en memoria durante el sync — causa de OOM en instancias de 512MB.
    if (req.rawBody) {
      fs.writeFileSync(DATA_FILE, req.rawBody);
      req.rawBody = null;
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf-8');
    }

    console.log(`🔄 Sync: ${events.length} ev, ${participants.length} part, ${results.length} res, ${splits.length} splits, ${laps.length} laps`);
    res.json({ message: 'Datos sincronizados', events: events.length, participants: participants.length, results: results.length, splits: splits.length, laps: laps.length });
  } catch (err) {
    res.status(500).json({ message: 'Error sincronizando: ' + err.message });
  }
});

// ============ PUBLIC API ============

const sportGroups = {
  running: ['running'],
  trail: ['trail_running'],
  cycling: ['mtb', 'gravel', 'mtb_gravel']
};

const sportLabel = {
  running: 'Running',
  trail_running: 'Trail Running',
  mtb: 'MTB',
  gravel: 'Gravel',
  mtb_gravel: 'MTB & Gravel'
};

// GET /api/public/events
app.get('/api/public/events', (req, res) => {
  try {
    const { sport, status } = req.query;
    let filtered = [...events];

    if (sport && sportGroups[sport]) {
      const allowed = new Set(sportGroups[sport]);
      filtered = filtered.filter(e => allowed.has(e.type));
    }

    const now = new Date();
    if (status === 'upcoming') {
      filtered = filtered.filter(e => new Date(e.date) >= now);
    } else if (status === 'completed') {
      filtered = filtered.filter(e => new Date(e.date) < now);
    }

    filtered.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      const aUpcoming = dateA >= now;
      const bUpcoming = dateB >= now;
      if (aUpcoming && !bUpcoming) return -1;
      if (!aUpcoming && bUpcoming) return 1;
      if (aUpcoming) return dateA - dateB;
      return dateB - dateA;
    });

    const light = filtered.map(e => ({
      id: e.id,
      name: e.name,
      date: e.date,
      location: e.location,
      type: e.type,
      typeLabel: sportLabel[e.type] || e.type,
      distance: e.distance,
      elevationGain: e.elevationGain || null,
      description: e.description || '',
      maxParticipants: e.maxParticipants,
      startHour: e.startHour,
      registrationUrl: e.registrationUrl || null,
      regulationUrl: e.regulationUrl || null,
      image: e.image || null,
      races: (e.races || []).map(r => ({
        id: r.id,
        name: r.name,
        distance: r.distance,
        elevationGain: r.elevationGain || null,
        rankingTier: r.rankingTier || null,
      })),
      status: new Date(e.date) >= now ? 'upcoming' : 'completed',
      totalParticipants: participants.filter(p => p.eventId === e.id).length,
      totalResults: results.filter(r => r.eventId === e.id && r.chipTime).length,
    }));

    res.json(light);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/events/:id
app.get('/api/public/events/:id', (req, res) => {
  try {
    const event = events.find(e => e.id === parseInt(req.params.id));
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const now = new Date();
    const eventParticipants = participants.filter(p => p.eventId === event.id);

    res.json({
      id: event.id,
      name: event.name,
      date: event.date,
      location: event.location,
      type: event.type,
      typeLabel: sportLabel[event.type] || event.type,
      distance: event.distance,
      elevationGain: event.elevationGain || null,
      description: event.description || '',
      maxParticipants: event.maxParticipants,
      startHour: event.startHour,
      registrationUrl: event.registrationUrl || null,
      regulationUrl: event.regulationUrl || null,
      image: event.image || null,
      poster: event.poster || null,
      sponsors: event.sponsors || [],
      races: (event.races || []).map(r => ({
        id: r.id,
        name: r.name,
        distance: r.distance,
        elevationGain: r.elevationGain || null,
        rankingTier: r.rankingTier || null,
      })),
      categories: (event.categories || []).map(c => ({
        name: c.name,
        gender: c.gender,
        minAge: c.minAge,
        maxAge: c.maxAge,
      })),
      gpxTracks: (() => {
        const hasGpxTracks = event.gpxTracks && Object.keys(event.gpxTracks).length > 0;
        const tracks = hasGpxTracks ? event.gpxTracks : {};
        if (!hasGpxTracks && event.gpxTrack) {
          return [{ raceId: '_default', raceName: null }];
        }
        return Object.keys(tracks).filter(k => tracks[k]).map(raceId => {
          const race = (event.races || []).find(r => r.id === raceId);
          return { raceId, raceName: race ? race.name : null };
        });
      })(),
      checkpoints: (event.checkpoints || []).map(c => ({
        lat: c.lat, lon: c.lon, ele: c.ele, km: c.km, name: c.name,
      })),
      status: new Date(event.date) >= now ? 'upcoming' : 'completed',
      totalParticipants: eventParticipants.length,
      totalResults: results.filter(r => r.eventId === event.id && r.chipTime).length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper: parse GPX XML string into point array
function parseGpxToPoints(gpx, maxPoints = 1500) {
  const points = [];
  const ptRegex = /<(?:trkpt|rtept)\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([^]*?)<\/(?:trkpt|rtept)>/g;
  const ptRegex2 = /<(?:trkpt|rtept)\s+lon="([^"]+)"\s+lat="([^"]+)"[^>]*>([^]*?)<\/(?:trkpt|rtept)>/g;
  let match;
  while ((match = ptRegex.exec(gpx)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : null;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
  }
  if (points.length === 0) {
    while ((match = ptRegex2.exec(gpx)) !== null) {
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
      const ele = eleMatch ? parseFloat(eleMatch[1]) : null;
      if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
    }
  }
  let sampled = points;
  if (points.length > maxPoints) {
    const every = Math.ceil(points.length / maxPoints);
    sampled = points.filter((_, i) => i % every === 0 || i === points.length - 1);
  }
  return { points: sampled, totalPoints: points.length };
}

const TRACK_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea'];

// GET /api/public/events/:id/gpx — GPX track data (parsed points, multi-track)
app.get('/api/public/events/:id/gpx', (req, res) => {
  try {
    const event = events.find(e => e.id === parseInt(req.params.id));
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const gpxTracks = (event.gpxTracks && Object.keys(event.gpxTracks).length > 0)
      ? event.gpxTracks
      : (event.gpxTrack ? { _default: event.gpxTrack } : {});
    const trackKeys = Object.keys(gpxTracks).filter(k => gpxTracks[k]);

    if (trackKeys.length === 0) {
      return res.status(404).json({ message: 'No hay tracks GPX' });
    }

    const { raceId } = req.query;
    if (raceId) {
      const gpx = gpxTracks[raceId];
      if (!gpx) return res.status(404).json({ message: 'Track no encontrado para este recorrido' });
      const parsed = parseGpxToPoints(gpx);
      const race = (event.races || []).find(r => r.id === raceId);
      return res.json({ raceId, raceName: race ? race.name : null, color: TRACK_COLORS[0], ...parsed });
    }

    const tracks = trackKeys.map((key, idx) => {
      const race = (event.races || []).find(r => r.id === key);
      const parsed = parseGpxToPoints(gpxTracks[key]);
      return { raceId: key, raceName: race ? race.name : null, color: TRACK_COLORS[idx % TRACK_COLORS.length], ...parsed };
    });

    res.json({ tracks });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper compartido: parsear HH:MM:SS.mmm → ms
function timeToMsHelper(t) {
  if (!t) return Infinity;
  const parts = t.split(':');
  if (parts.length < 3) return Infinity;
  const secParts = (parts[2] || '0').split('.');
  return ((parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(secParts[0])) * 1000 + (parseInt(secParts[1] || '0'));
}

// Helper compartido: ms → HH:MM:SS.mmm
function msToTimeHelper(ms) {
  if (ms === Infinity || ms < 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

// Helper: aplicar offset a un tiempo dado los segundos de retraso
function applyOffsetToTime(timeStr, offsetSeconds) {
  if (!timeStr || !offsetSeconds || offsetSeconds === 0) return timeStr;
  const ms = timeToMsHelper(timeStr);
  if (ms === Infinity) return timeStr;
  return msToTimeHelper(Math.max(0, ms - offsetSeconds * 1000));
}

// GET /api/public/results/:eventId
app.get('/api/public/results/:eventId', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const { raceId, gender } = req.query;

    let eventResults = results.filter(r => r.eventId === eventId);
    if (raceId) {
      eventResults = eventResults.filter(r => r.raceId === raceId);
    }

    let enriched = eventResults.map(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === eventId);
      if (!p) return null;
      const rId = r.raceId || p.raceId || null;
      const race = rId ? (event.races || []).find(rr => rr.id === rId) : null;
      // Calcular tiempo oficial: r.time si lo trae, si no chipTime - offset
      let officialTime = r.time || null;
      if (!officialTime && r.chipTime) {
        officialTime = applyOffsetToTime(r.chipTime, race?.startOffset || 0);
      }
      return {
        bib: r.bib,
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        team: p.team || null,
        category: p.category || null,
        province: p.province || null,
        isLocal: p.isLocal || false,
        raceId: rId,
        raceName: race?.name || null,
        chipTime: officialTime,           // Lo que ven corredores (ya con offset)
        chipTimeRaw: r.chipTime || null,   // Tiempo bruto desde inicio del evento
        netTime: officialTime,
        position: r.position || null,
        categoryPosition: r.categoryPosition || null,
        genderPosition: r.genderPosition || null,
        status: !r.chipTime && !r.startTime ? 'DNS' : !r.chipTime ? 'DNF' : 'Finalizado',
      };
    }).filter(Boolean);

    const filterByGender = gender === 'male' || gender === 'female';
    if (filterByGender) {
      enriched = enriched.filter(r => r.gender === gender);
    }

    const timeToMs = (t) => {
      if (!t) return Infinity;
      const parts = t.split(':');
      const secParts = (parts[2] || '0').split('.');
      return ((parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(secParts[0])) * 1000 + (parseInt(secParts[1] || '0'));
    };

    enriched.sort((a, b) => {
      if (a.status === 'Finalizado' && b.status !== 'Finalizado') return -1;
      if (a.status !== 'Finalizado' && b.status === 'Finalizado') return 1;
      if (a.status === 'Finalizado' && b.status === 'Finalizado') {
        return timeToMs(a.chipTime) - timeToMs(b.chipTime);
      }
      if (a.status === 'DNF' && b.status === 'DNS') return -1;
      if (a.status === 'DNS' && b.status === 'DNF') return 1;
      return 0;
    });

    let pos = 1;
    const catCounters = {};
    const genCounters = {};
    enriched.forEach(r => {
      if (r.status === 'Finalizado') {
        r.position = pos++;
        if (r.category) {
          catCounters[r.category] = (catCounters[r.category] || 0) + 1;
          r.categoryPosition = catCounters[r.category];
        }
        if (r.gender) {
          genCounters[r.gender] = (genCounters[r.gender] || 0) + 1;
          r.genderPosition = genCounters[r.gender];
        }
      } else {
        r.position = null;
      }
    });

    res.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
        type: event.type,
        distance: event.distance,
        elevationGain: event.elevationGain || null,
        image: event.image || null,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance, elevationGain: r.elevationGain || null, rankingTier: r.rankingTier || null })),
      },
      results: enriched,
      total: enriched.length,
      totalFinished: enriched.filter(r => r.status === 'Finalizado').length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/splits/:eventId
app.get('/api/public/splits/:eventId', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = events.find(e => e.id === eventId);
    const hasRaces = event?.races?.length > 0;
    const raceOffsetMap = {};
    if (hasRaces) {
      event.races.forEach(race => {
        raceOffsetMap[race.id] = (race.startOffset || 0) * 1000;
      });
    }
    const eventSplits = splits
      .filter(s => s.eventId === eventId)
      .sort((a, b) => a.splitIndex - b.splitIndex)
      .map(s => ({
        splitIndex: s.splitIndex,
        name: s.name,
        data: (s.data || []).map(d => {
          const p = participants.find(pp => pp.bib === d.bib && pp.eventId === eventId);
          const offsetMs = (p?.raceId && raceOffsetMap[p.raceId]) ? raceOffsetMap[p.raceId] : 0;
          const adjustTime = (t) => {
            if (!t || offsetMs <= 0) return t;
            const parts = t.split(':');
            const ms = (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
            const net = Math.max(0, ms - offsetMs);
            const h = Math.floor(net / 3600000); const m = Math.floor((net % 3600000) / 60000); const s2 = ((net % 60000) / 1000).toFixed(3);
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${s2.padStart(6,'0')}`;
          };
          return {
            bib: d.bib,
            time: adjustTime(d.time),
            cumulative: adjustTime(d.cumulative || d.time),
            firstName: p?.firstName || null,
            lastName: p?.lastName || null,
            category: p?.category || null,
            team: p?.team || null,
            gender: p?.gender || null,
          };
        })
      }));
    res.json(eventSplits);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/ranking
app.get('/api/public/ranking', (req, res) => {
  try {
    const { sport, gender, year, limit: limitStr } = req.query;
    const yearFilter = year ? parseInt(year) : null;
    const maxResults = Math.min(parseInt(limitStr) || 50, 200);

    // Calcular años disponibles
    const yearsSet = new Set();
    events.forEach(evt => {
      if (evt.date) yearsSet.add(new Date(evt.date).getFullYear());
    });
    const availableYears = [...yearsSet].sort((a, b) => b - a);

    const tierMultiplier = { gold: 1.0, silver: 0.75, bronze: 0.50 };
    const sportGroupsFilter = sport && sportGroups[sport] ? new Set(sportGroups[sport]) : null;

    const raceTierMap = {};
    const excludedRaces = new Set();
    events.forEach(evt => {
      if (sportGroupsFilter && !sportGroupsFilter.has(evt.type)) return;
      if (yearFilter && new Date(evt.date).getFullYear() !== yearFilter) return;
      const hasRaces = evt.races && evt.races.length > 0;
      if (hasRaces) {
        evt.races.forEach(race => {
          const key = `${evt.id}_${race.id}`;
          if (race.rankingTier) raceTierMap[key] = race.rankingTier;
          else excludedRaces.add(key);
        });
      } else {
        raceTierMap[`${evt.id}_none`] = evt.rankingTier || 'gold';
      }
    });

    const getGoldPoints = (pos) => {
      if (pos === 1) return 200;
      if (pos === 2) return 185;
      if (pos === 3) return 175;
      if (pos === 4) return 170;
      if (pos === 5) return 165;
      if (pos <= 165) return 165 - (pos - 5);
      if (pos <= 200) return 5;
      if (pos <= 250) return 4;
      if (pos <= 300) return 3;
      if (pos <= 350) return 2;
      return 1;
    };

    const participantMap = {};
    participants.forEach(p => {
      const key = `${p.firstName.toLowerCase().trim()}_${p.lastName.toLowerCase().trim()}_${p.gender}`;
      if (!participantMap[key]) {
        participantMap[key] = {
          key, firstName: p.firstName, lastName: p.lastName, gender: p.gender,
          team: p.team, province: p.province || null,
          totalPoints: 0, totalRaces: 0, totalPodiums: 0, bestPosition: null,
          results: [],
        };
      }
      if (p.team) participantMap[key].team = p.team;
      if (p.province) participantMap[key].province = p.province;
    });

    const qualifyingFilter = (r) => {
      if (!r.chipTime) return false;
      const ev = events.find(e => e.id === r.eventId);
      if (!ev) return false;
      if (sportGroupsFilter && !sportGroupsFilter.has(ev.type)) return false;
      if (yearFilter && new Date(ev.date).getFullYear() !== yearFilter) return false;
      const raceKey = (ev.races?.length > 0 && r.raceId) ? r.raceId : 'none';
      const fullKey = `${r.eventId}_${raceKey}`;
      return !excludedRaces.has(fullKey) && !!raceTierMap[fullKey];
    };

    const timeToMs = (t) => {
      if (!t) return Infinity;
      const parts = t.split(':');
      const secParts = (parts[2] || '0').split('.');
      return ((parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(secParts[0])) * 1000 + (parseInt(secParts[1] || '0'));
    };

    const genderPosCache = {};
    results.filter(qualifyingFilter).forEach(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === r.eventId);
      if (!p) return;
      const ev = events.find(e => e.id === r.eventId);
      const raceKey = (ev?.races?.length > 0 && r.raceId) ? r.raceId : 'none';
      const ck = `${r.eventId}_${raceKey}_${p.gender}`;
      if (!genderPosCache[ck]) genderPosCache[ck] = [];
      genderPosCache[ck].push({ bib: r.bib, chipTime: r.chipTime });
    });

    Object.values(genderPosCache).forEach(g => g.sort((a, b) => timeToMs(a.chipTime) - timeToMs(b.chipTime)));

    results.filter(qualifyingFilter).forEach(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === r.eventId);
      if (!p) return;
      const key = `${p.firstName.toLowerCase().trim()}_${p.lastName.toLowerCase().trim()}_${p.gender}`;
      const entry = participantMap[key];
      if (!entry) return;
      const ev = events.find(e => e.id === r.eventId);
      if (!ev) return;
      const raceKey = (ev.races?.length > 0 && r.raceId) ? r.raceId : 'none';
      const fullKey = `${r.eventId}_${raceKey}`;
      const ck = `${r.eventId}_${raceKey}_${p.gender}`;
      const group = genderPosCache[ck] || [];
      const pos = group.findIndex(g => g.bib === r.bib) + 1;
      const tier = raceTierMap[fullKey] || 'gold';
      const pts = Math.round(getGoldPoints(pos) * (tierMultiplier[tier] || 1.0));

      // Race detail info
      let raceDistance = ev.distance;
      let raceName = null;
      if (ev.races?.length > 0 && r.raceId) {
        const race = ev.races.find(rc => rc.id === r.raceId);
        if (race) { raceDistance = race.distance; raceName = race.name; }
      }

      const totalInEvent = group.length;

      entry.totalPoints += pts;
      entry.totalRaces++;
      if (pos <= 3) entry.totalPodiums++;
      if (!entry.bestPosition || pos < entry.bestPosition) entry.bestPosition = pos;
      entry.results.push({
        eventId: r.eventId, eventName: ev.name, raceName,
        position: pos, time: r.chipTime, points: pts,
        totalParticipants: totalInEvent, date: ev.date,
        distance: raceDistance, tier,
      });
    });

    let ranked = Object.values(participantMap).filter(p => p.totalRaces > 0);

    // Sort results by date (most recent first)
    ranked.forEach(p => {
      p.results.sort((a, b) => new Date(b.date) - new Date(a.date));
    });

    if (gender === 'male' || gender === 'female') {
      ranked = ranked.filter(p => p.gender === gender);
    }

    ranked.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.totalRaces !== a.totalRaces) return b.totalRaces - a.totalRaces;
      return (a.bestPosition || 999) - (b.bestPosition || 999);
    });

    ranked = ranked.slice(0, maxResults);
    ranked.forEach((p, i) => { p.rankPosition = i + 1; });

    res.json({
      ranking: ranked,
      total: ranked.length,
      sportFilter: sport || null,
      genderFilter: gender || null,
      yearFilter: yearFilter || null,
      availableYears,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Privacy Policy (required for App Store)
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidad - Viriato Tempo</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
  h1 { color: #1a1a2e; }
  h2 { color: #444; margin-top: 30px; }
</style>
</head>
<body>
<h1>Política de Privacidad</h1>
<p><strong>Viriato Tempo</strong> — Última actualización: 1 de marzo de 2026</p>

<h2>1. Información que recopilamos</h2>
<p>Viriato Tempo no recopila datos personales de los usuarios de la aplicación. La app muestra información pública sobre eventos deportivos, resultados y clasificaciones.</p>
<p>Los datos de participantes (nombre, dorsal, equipo, categoría, tiempos) son proporcionados por los organizadores de cada evento y son de carácter público, al igual que en cualquier clasificación oficial de una carrera deportiva.</p>

<h2>2. Uso de datos</h2>
<p>No utilizamos cookies, ni rastreadores, ni herramientas de analítica en la aplicación. No recopilamos información sobre tu dispositivo ni tu ubicación.</p>

<h2>3. Almacenamiento</h2>
<p>La aplicación no almacena datos personales en tu dispositivo. Toda la información se obtiene en tiempo real del servidor.</p>

<h2>4. Terceros</h2>
<p>No compartimos ningún dato con terceros. No utilizamos servicios de publicidad ni de analítica de terceros.</p>

<h2>5. Contacto</h2>
<p>Si tienes preguntas sobre esta política de privacidad, puedes contactarnos en:</p>
<p>Viriato Terra Eventos Deportivos<br>Email: info@viriatoterra.com</p>
</body>
</html>`);
});

// POST /api/public/lookup — Consulta de dorsal por DNI
app.post('/api/public/lookup', (req, res) => {
  try {
    const { eventId, dni } = req.body;
    if (!eventId || !dni) return res.status(400).json({ message: 'eventId y dni requeridos' });

    const event = events.find(e => e.id === parseInt(eventId));
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const normalDni = dni.toString().toUpperCase().replace(/[\s\-\.]/g, '');
    const match = participants.find(p =>
      p.eventId === parseInt(eventId) &&
      p.dni && p.dni.toUpperCase().replace(/[\s\-\.]/g, '') === normalDni
    );

    if (!match) {
      return res.status(404).json({ message: 'No se encontró ningún inscrito con ese documento' });
    }

    const race = match.raceId
      ? (event.races || []).find(r => String(r.id) === String(match.raceId))
      : null;

    res.json({
      found: true,
      bib: match.bib || null,
      firstName: match.firstName,
      lastName: match.lastName,
      category: match.category || null,
      team: match.team || null,
      race: race ? race.name : null,
      talla: match.talla || null,
      gender: match.gender || null,
      province: match.province || null,
      event: { id: event.id, name: event.name, date: event.date },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/participants/:eventId — Lista de inscritos
app.get('/api/public/participants/:eventId', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const { raceId } = req.query;
    let eventParticipants = participants.filter(p => p.eventId === eventId);
    if (raceId) {
      eventParticipants = eventParticipants.filter(p => String(p.raceId) === String(raceId));
    }

    eventParticipants.sort((a, b) => {
      const aBib = parseInt(a.bib) || 99999;
      const bBib = parseInt(b.bib) || 99999;
      if (aBib !== bBib) return aBib - bBib;
      return (a.lastName || '').localeCompare(b.lastName || '');
    });

    const mapped = eventParticipants.map(p => ({
      id: p.id,
      bib: p.bib || null,
      firstName: p.firstName,
      lastName: p.lastName,
      gender: p.gender || null,
      team: p.team || null,
      category: p.category || null,
      province: p.province || null,
      locality: p.locality || null,
      raceId: p.raceId || null,
    }));

    res.json({
      event: {
        id: event.id, name: event.name, date: event.date,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance })),
      },
      participants: mapped,
      total: mapped.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/results/:eventId/team-classification — Clasificación por equipos
// IMPORTANT: Must be BEFORE /:eventId/:bib to avoid being caught by the :bib param
app.get('/api/public/results/:eventId/team-classification', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const { raceId, mode, method: methodParam } = req.query;
    const scoringMembers = parseInt(req.query.scoringMembers) || 3;
    const method = methodParam || 'positions';
    const genderMode = mode || 'mixed';

    const timeToMs2 = (t) => {
      if (!t) return Infinity;
      const parts = t.split(':');
      const secParts = (parts[2] || '0').split('.');
      return ((parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(secParts[0])) * 1000
        + (parseInt(secParts[1] || '0'));
    };

    const msToTimeString = (ms) => {
      if (!ms || ms <= 0) return '00:00:00';
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    let eventResults = results.filter(r => r.eventId === eventId && r.chipTime);
    if (raceId) eventResults = eventResults.filter(r => r.raceId === raceId);

    let resultsWithParticipants = eventResults.map(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === eventId);
      return p ? { ...r, participant: p } : null;
    }).filter(Boolean).sort((a, b) => a.position - b.position);

    if (genderMode === 'male') {
      resultsWithParticipants = resultsWithParticipants.filter(r => r.participant.gender === 'male');
    } else if (genderMode === 'female') {
      resultsWithParticipants = resultsWithParticipants.filter(r => r.participant.gender === 'female');
    }

    resultsWithParticipants.forEach((r, i) => { r.genderPosition = i + 1; });

    const teamMap = {};
    resultsWithParticipants.forEach(r => {
      const teamName = r.participant.team;
      if (!teamName) return;
      if (teamName.toUpperCase().includes('INDEPENDIENTE')) return;
      if (teamName.toUpperCase() === 'INDIVIDUAL') return;
      if (!teamMap[teamName]) teamMap[teamName] = [];
      teamMap[teamName].push({
        bib: r.bib,
        firstName: r.participant.firstName,
        lastName: r.participant.lastName,
        gender: r.participant.gender,
        category: r.participant.category,
        position: r.genderPosition,
        chipTime: r.chipTime,
        time: r.time || r.chipTime,
      });
    });

    const teams = [];
    Object.entries(teamMap).forEach(([teamName, members]) => {
      members.sort((a, b) => a.position - b.position);
      if (method === 'finishers') {
        teams.push({ team: teamName, score: members.length, scoringMembers: members, totalMembers: members.length, allMembers: members });
      } else {
        if (members.length < scoringMembers) return;
        const scoringList = members.slice(0, scoringMembers);
        let score;
        if (method === 'times') {
          score = scoringList.reduce((sum, m) => sum + timeToMs2(m.time || m.chipTime || '99:99:99.999'), 0);
        } else {
          score = scoringList.reduce((sum, m) => sum + m.position, 0);
        }
        teams.push({ team: teamName, score, scoringMembers: scoringList, totalMembers: members.length, allMembers: members });
      }
    });

    if (method === 'finishers') {
      teams.sort((a, b) => b.score - a.score);
    } else {
      teams.sort((a, b) => a.score - b.score);
    }

    teams.forEach((t, i) => {
      t.position = i + 1;
      if (method === 'times') t.scoreFormatted = msToTimeString(t.score);
      else if (method === 'finishers') t.scoreFormatted = String(t.score) + ' fin.';
      else t.scoreFormatted = String(t.score) + ' pts';
    });

    res.json({
      teams,
      config: { scoringMembers, mode: genderMode, method },
      eventName: event.name,
      totalTeams: teams.length,
      races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/results/:eventId/:bib — Detalle de un corredor
app.get('/api/public/results/:eventId/:bib', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const bib = req.params.bib;
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const participant = participants.find(p => p.bib === bib && p.eventId === eventId);
    if (!participant) return res.status(404).json({ message: 'Participante no encontrado' });

    const result = results.find(r => r.bib === bib && r.eventId === eventId);

    // Carrera del corredor + offset
    const race = (event.races || []).find(r => r.id === (result?.raceId || participant.raceId));
    const raceDistance = race?.distance || event.distance || 0;
    const raceOffsetMs = (race?.startOffset || 0) * 1000;
    const applyOffsetMs = (timeStr) => {
      if (!timeStr) return null;
      if (raceOffsetMs === 0) return timeStr;
      const ms = timeToMsHelper(timeStr);
      if (ms === Infinity) return timeStr;
      return msToTimeHelper(Math.max(0, ms - raceOffsetMs));
    };

    const status = !result ? 'DNS'
      : !result.chipTime && !result.startTime ? 'DNS'
      : !result.chipTime ? 'DNF'
      : 'Finalizado';

    // === Posiciones general/categoría/género + totales ===
    let categoryPosition = null;
    let genderPosition = null;
    let totalFinishers = 0;
    let totalCategory = 0;
    let totalGender = 0;

    let raceResults = results.filter(r => r.eventId === eventId && r.chipTime && !r.isOTL);
    if (result?.raceId) raceResults = raceResults.filter(r => r.raceId === result.raceId);
    else if (participant.raceId) raceResults = raceResults.filter(r => r.raceId === participant.raceId);

    const enrichedAll = raceResults.map(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === eventId);
      return p ? { bib: r.bib, chipTime: r.chipTime, penalty: r.penalty, gender: p.gender, category: p.category } : null;
    }).filter(Boolean).sort((a, b) => {
      const aT = timeToMsHelper(a.chipTime) + (a.penalty ? timeToMsHelper(a.penalty) : 0);
      const bT = timeToMsHelper(b.chipTime) + (b.penalty ? timeToMsHelper(b.penalty) : 0);
      return aT - bT;
    });

    totalFinishers = enrichedAll.length;
    if (participant.category) {
      const catResults = enrichedAll.filter(r => r.category === participant.category);
      totalCategory = catResults.length;
      const catIdx = catResults.findIndex(r => r.bib === bib);
      if (catIdx >= 0) categoryPosition = catIdx + 1;
    }
    if (participant.gender) {
      const genResults = enrichedAll.filter(r => r.gender === participant.gender);
      totalGender = genResults.length;
      const genIdx = genResults.findIndex(r => r.bib === bib);
      if (genIdx >= 0) genderPosition = genIdx + 1;
    }

    // === Splits con posición por punto y offset aplicado ===
    const eventSplits = splits.filter(s => s.eventId === eventId).sort((a, b) => a.splitIndex - b.splitIndex);
    const runnerSplits = eventSplits.map(s => {
      const entry = (s.data || []).find(d => d.bib === bib);
      if (!entry || !entry.time) return null;

      const myCumRaw = entry.cumulative || entry.time;
      const myCum = applyOffsetMs(myCumRaw);
      const myCumMs = timeToMsHelper(myCum);

      // Posiciones en este split — comparar entre corredores de la misma carrera
      const splitData = (s.data || []).filter(d => d.bib && d.time)
        .map(d => {
          const p = participants.find(pp => pp.bib === d.bib && pp.eventId === eventId);
          if (!p) return null;
          const otherRaceId = p.raceId || null;
          if (result?.raceId && otherRaceId && otherRaceId !== result.raceId) return null;
          const otherRace = otherRaceId ? (event.races || []).find(rr => rr.id === otherRaceId) : null;
          const otherOffsetMs = (otherRace?.startOffset || 0) * 1000;
          const rawMs = timeToMsHelper(d.cumulative || d.time);
          const adjustedMs = rawMs === Infinity ? Infinity : Math.max(0, rawMs - otherOffsetMs);
          return { bib: d.bib, cumMs: adjustedMs, gender: p.gender, category: p.category };
        }).filter(Boolean).sort((a, b) => a.cumMs - b.cumMs);

      const overallIdx = splitData.findIndex(d => d.bib === bib);
      const catData = splitData.filter(d => d.category === participant.category);
      const catIdx = catData.findIndex(d => d.bib === bib);
      const genData = splitData.filter(d => d.gender === participant.gender);
      const genIdx = genData.findIndex(d => d.bib === bib);

      const splitDist = event.splitDistances?.[s.splitIndex]?.km || (
        eventSplits.length > 0 && raceDistance > 0
          ? Math.round((raceDistance * (s.splitIndex + 1) / (eventSplits.length + 1)) * 10) / 10
          : null
      );

      let paceStr = null;
      if (splitDist && myCumMs > 0 && myCumMs !== Infinity) {
        const paceSec = (myCumMs / 1000) / splitDist;
        const m = Math.floor(paceSec / 60);
        const s2 = Math.round(paceSec % 60);
        paceStr = `${m}:${String(s2).padStart(2, '0')}`;
      }

      return {
        splitIndex: s.splitIndex,
        name: s.name || `Punto ${s.splitIndex + 1}`,
        distance: splitDist,
        time: entry.time,
        cumulative: myCum,
        cumulativeRaw: myCumRaw,
        pace: paceStr,
        positionOverall: overallIdx >= 0 ? overallIdx + 1 : null,
        positionCategory: catIdx >= 0 ? catIdx + 1 : null,
        positionGender: genIdx >= 0 ? genIdx + 1 : null,
      };
    }).filter(Boolean);

    // === Vueltas (laps) del corredor con offset aplicado ===
    const eventLaps = laps.filter(l => l.eventId === eventId).sort((a, b) => a.lapNumber - b.lapNumber);
    const runnerLaps = [];
    let prevCumMs = 0;
    for (const lap of eventLaps) {
      const entry = (lap.data || []).find(d => String(d.bib) === String(bib));
      if (!entry || !entry.time) continue;
      const rawCumMs = timeToMsHelper(entry.time);
      const adjustedCumMs = Math.max(0, rawCumMs - raceOffsetMs);
      const lapTimeMs = prevCumMs > 0 ? Math.max(0, adjustedCumMs - prevCumMs) : adjustedCumMs;
      runnerLaps.push({
        lapNumber: lap.lapNumber,
        cumulative: msToTimeHelper(adjustedCumMs),
        lapTime: msToTimeHelper(lapTimeMs),
        cumulativeRaw: entry.time,
      });
      prevCumMs = adjustedCumMs;
    }

    // === Tiempo neto y oficial ===
    const officialTime = result?.time || applyOffsetMs(result?.chipTime) || null;
    const netTime = officialTime;

    // === Pace global y velocidad ===
    let globalPace = null;
    let speedKmh = null;
    if (officialTime && raceDistance > 0) {
      const ms = timeToMsHelper(officialTime);
      if (ms > 0 && ms !== Infinity) {
        const totalSec = ms / 1000;
        const paceSec = totalSec / raceDistance;
        const m = Math.floor(paceSec / 60);
        const s2 = Math.round(paceSec % 60);
        globalPace = `${m}:${String(s2).padStart(2, '0')}`;
        speedKmh = Math.round((raceDistance / (totalSec / 3600)) * 100) / 100;
      }
    }

    res.json({
      bib: participant.bib,
      firstName: participant.firstName,
      lastName: participant.lastName,
      gender: participant.gender,
      team: participant.team || null,
      category: participant.category || null,
      province: participant.province || null,
      city: participant.city || null,
      isLocal: participant.isLocal || false,
      raceId: result?.raceId || participant.raceId || null,
      raceName: race?.name || null,
      raceDistance,
      raceElevation: race?.elevationGain || null,
      chipTime: officialTime,
      chipTimeRaw: result?.chipTime || null,
      netTime,
      officialTime,
      startTime: result?.startTime || null,
      position: result?.position || null,
      categoryPosition,
      genderPosition,
      totalFinishers,
      totalCategory,
      totalGender,
      pace: globalPace,
      speedKmh,
      penalty: result?.penalty || null,
      penaltyReason: result?.penaltyReason || null,
      status,
      splits: runnerSplits,
      laps: runnerLaps,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
        distance: event.distance,
        elevationGain: event.elevationGain || null,
        image: event.image || null,
        poster: event.poster || null,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance, elevationGain: r.elevationGain || null })),
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/compare/:eventId?bibs=1,2,3 — Comparar hasta 3 corredores
app.get('/api/public/compare/:eventId', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const bibsParam = req.query.bibs || '';
    const bibs = bibsParam.split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
    if (bibs.length === 0) return res.status(400).json({ message: 'Parámetro bibs requerido' });

    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const eventSplits = splits.filter(s => s.eventId === eventId).sort((a, b) => a.splitIndex - b.splitIndex);

    const runners = bibs.map(bib => {
      const participant = participants.find(p => p.bib === bib && p.eventId === eventId);
      if (!participant) return { bib, error: 'Participante no encontrado' };
      const result = results.find(r => r.bib === bib && r.eventId === eventId);
      const race = (event.races || []).find(r => r.id === (result?.raceId || participant.raceId));
      const raceDistance = race?.distance || event.distance || 0;
      const offsetMs = (race?.startOffset || 0) * 1000;

      const adjust = (t) => {
        if (!t) return null;
        if (offsetMs === 0) return t;
        const ms = timeToMsHelper(t);
        if (ms === Infinity) return t;
        return msToTimeHelper(Math.max(0, ms - offsetMs));
      };

      const runnerSplits = eventSplits.map(s => {
        const entry = (s.data || []).find(d => d.bib === bib);
        if (!entry) return { splitIndex: s.splitIndex, name: s.name || `Punto ${s.splitIndex + 1}`, time: null, cumulative: null };
        return {
          splitIndex: s.splitIndex,
          name: s.name || `Punto ${s.splitIndex + 1}`,
          time: entry.time || null,
          cumulative: adjust(entry.cumulative || entry.time) || null,
        };
      });

      const officialTime = result?.time || adjust(result?.chipTime) || null;
      let pace = null;
      if (officialTime && raceDistance > 0) {
        const ms = timeToMsHelper(officialTime);
        if (ms !== Infinity) {
          const paceSec = (ms / 1000) / raceDistance;
          const m = Math.floor(paceSec / 60);
          const s2 = Math.round(paceSec % 60);
          pace = `${m}:${String(s2).padStart(2, '0')}`;
        }
      }

      return {
        bib: participant.bib,
        firstName: participant.firstName,
        lastName: participant.lastName,
        gender: participant.gender,
        category: participant.category,
        team: participant.team,
        province: participant.province,
        raceId: result?.raceId || participant.raceId || null,
        raceName: race?.name || null,
        raceDistance,
        chipTime: officialTime,
        position: result?.position || null,
        pace,
        status: !result ? 'DNS' : !result.chipTime && !result.startTime ? 'DNS' : !result.chipTime ? 'DNF' : 'Finalizado',
        splits: runnerSplits,
      };
    });

    res.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance })),
      },
      splits: eventSplits.map(s => ({ splitIndex: s.splitIndex, name: s.name || `Punto ${s.splitIndex + 1}` })),
      runners,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/public/podiums/:eventId — Podios públicos
app.get('/api/public/podiums/:eventId', (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const { raceId } = req.query;
    const topN = Math.min(parseInt(req.query.topN) || 3, 10);
    const cumulative = req.query.cumulative === 'true';

    let eventResults = results.filter(r => r.eventId === eventId && r.chipTime);
    if (raceId) eventResults = eventResults.filter(r => r.raceId === raceId);

    let resultsWithParticipants = eventResults.map(r => {
      const p = participants.find(pp => pp.bib === r.bib && pp.eventId === eventId);
      return { ...r, participant: p || null };
    }).filter(r => r.participant).sort((a, b) => a.position - b.position);

    const mapPodiumEntry = (r, i) => ({
      position: i + 1,
      bib: r.bib,
      firstName: r.participant.firstName,
      lastName: r.participant.lastName,
      team: r.participant.team,
      category: r.participant.category,
      gender: r.participant.gender,
      time: (r.chipTime || r.time).split('.')[0],
      province: r.participant.province,
    });

    const maleResults = resultsWithParticipants.filter(r => r.participant.gender === 'male');
    const generalMale = maleResults.slice(0, topN).map(mapPodiumEntry);

    const femaleResults = resultsWithParticipants.filter(r => r.participant.gender === 'female');
    const generalFemale = femaleResults.slice(0, topN).map(mapPodiumEntry);

    const generalMaleBibs = new Set(generalMale.map(r => r.bib));
    const generalFemaleBibs = new Set(generalFemale.map(r => r.bib));

    const categories = {};
    const allCategories = [...new Set(resultsWithParticipants.map(r => r.participant.category).filter(Boolean))].sort();

    allCategories.forEach(cat => {
      let catResults = resultsWithParticipants.filter(r => r.participant.category === cat);
      if (!cumulative) {
        catResults = catResults.filter(r => !generalMaleBibs.has(r.bib) && !generalFemaleBibs.has(r.bib));
      }
      categories[cat] = catResults.slice(0, topN).map(mapPodiumEntry);
    });

    res.json({
      generalMale,
      generalFemale,
      categories,
      settings: { topN, cumulative },
      event: {
        id: event.id, name: event.name, image: event.image || null,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance })),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    events: events.length,
    participants: participants.length,
    results: results.length,
  });
});

// GET /api/public/share-image/:eventId/:bib — Genera imagen PNG (Stories) para iOS/Android
app.get('/api/public/share-image/:eventId/:bib', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const bib = req.params.bib;
    const { raceId } = req.query;
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });

    const participant = participants.find(p => p.bib === bib && p.eventId === eventId);
    if (!participant) return res.status(404).json({ message: 'Participante no encontrado' });

    const result = results.find(r => r.bib === bib && r.eventId === eventId);

    const status = !result ? 'DNS'
      : !result.chipTime && !result.startTime ? 'DNS'
      : !result.chipTime ? 'DNF'
      : 'Finalizado';

    // Carrera del corredor + offset
    const race = raceId
      ? (event.races || []).find(r => String(r.id) === String(raceId))
      : (result?.raceId ? (event.races || []).find(r => String(r.id) === String(result.raceId)) : null);
    const raceName = race ? race.name : null;
    const distance = race ? race.distance : event.distance;
    const elevationGain = race ? (race.elevationGain || event.elevationGain) : event.elevationGain;
    const raceOffsetMs = (race?.startOffset || 0) * 1000;
    const applyOffsetMs = (timeStr) => {
      if (!timeStr) return null;
      if (raceOffsetMs === 0) return timeStr;
      const ms = timeToMsHelper(timeStr);
      if (ms === Infinity) return timeStr;
      return msToTimeHelper(Math.max(0, ms - raceOffsetMs));
    };

    // Posiciones general/categoría/género
    let categoryPosition = null;
    let genderPosition = null;
    if (result && result.chipTime) {
      let raceResults = results.filter(r => r.eventId === eventId && r.chipTime && !r.isOTL);
      if (result.raceId) raceResults = raceResults.filter(r => r.raceId === result.raceId);
      const enrichedAll = raceResults.map(r => {
        const p = participants.find(pp => pp.bib === r.bib && pp.eventId === eventId);
        return p ? { bib: r.bib, chipTime: r.chipTime, penalty: r.penalty, gender: p.gender, category: p.category } : null;
      }).filter(Boolean).sort((a, b) => {
        const aT = timeToMsHelper(a.chipTime) + (a.penalty ? timeToMsHelper(a.penalty) : 0);
        const bT = timeToMsHelper(b.chipTime) + (b.penalty ? timeToMsHelper(b.penalty) : 0);
        return aT - bT;
      });
      if (participant.category) {
        const catIdx = enrichedAll.filter(r => r.category === participant.category).findIndex(r => r.bib === bib);
        if (catIdx >= 0) categoryPosition = catIdx + 1;
      }
      if (participant.gender) {
        const genIdx = enrichedAll.filter(r => r.gender === participant.gender).findIndex(r => r.bib === bib);
        if (genIdx >= 0) genderPosition = genIdx + 1;
      }
    }

    // Splits del corredor con offset aplicado
    const runnerSplits = splits
      .filter(s => s.eventId === eventId)
      .sort((a, b) => a.splitIndex - b.splitIndex)
      .map(s => {
        const entry = (s.data || []).find(d => d.bib === bib);
        if (!entry) return null;
        return {
          splitIndex: s.splitIndex,
          name: s.name || `Punto ${s.splitIndex + 1}`,
          time: entry.time,
          cumulative: applyOffsetMs(entry.cumulative || entry.time),
        };
      })
      .filter(Boolean);

    // GPX track del corredor
    let gpxPoints = null;
    const gpxTracks = (event.gpxTracks && Object.keys(event.gpxTracks).length > 0)
      ? event.gpxTracks
      : (event.gpxTrack ? { _default: event.gpxTrack } : {});
    const trackKey = race ? race.id : Object.keys(gpxTracks)[0];
    if (trackKey && gpxTracks[trackKey]) {
      const parsed = parseGpxToPoints(gpxTracks[trackKey]);
      if (parsed.points && parsed.points.length >= 2) gpxPoints = parsed.points;
    }

    // Vueltas (laps) del corredor con offset aplicado
    const eventLaps = laps.filter(l => l.eventId === eventId).sort((a, b) => a.lapNumber - b.lapNumber);
    const runnerLaps = [];
    let prevCumMs = 0;
    for (const lap of eventLaps) {
      const entry = (lap.data || []).find(d => String(d.bib) === String(bib));
      if (!entry || !entry.time) continue;
      const rawCumMs = timeToMsHelper(entry.time);
      const adjustedCumMs = Math.max(0, rawCumMs - raceOffsetMs);
      const lapTimeMs = prevCumMs > 0 ? Math.max(0, adjustedCumMs - prevCumMs) : adjustedCumMs;
      runnerLaps.push({
        lapNumber: lap.lapNumber,
        cumulative: msToTimeHelper(adjustedCumMs),
        lapTime: msToTimeHelper(lapTimeMs),
      });
      prevCumMs = adjustedCumMs;
    }

    // Tiempo oficial (con offset aplicado)
    const officialTime = result?.time || applyOffsetMs(result?.chipTime) || null;

    const detail = {
      bib: participant.bib,
      firstName: participant.firstName,
      lastName: participant.lastName,
      gender: participant.gender,
      team: participant.team || null,
      category: participant.category || null,
      chipTime: officialTime,
      officialTime,
      position: result?.position || null,
      categoryPosition,
      genderPosition,
      status,
      splits: runnerSplits,
      laps: runnerLaps,
    };

    const eventInfo = {
      name: event.name,
      date: event.date,
      location: event.location,
      type: event.type,
    };

    const posterUrl = event.poster || event.image || null;

    const pngBuffer = await generateShareImage(detail, eventInfo, raceName, distance, posterUrl, gpxPoints, elevationGain, runnerLaps);

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.set('Content-Disposition', `inline; filename="resultado-${bib}.png"`);
    res.send(pngBuffer);
  } catch (error) {
    console.error('Share image error:', error);
    res.status(500).json({ message: 'Error generando imagen', error: error.message });
  }
});

// Image proxy — para compartir en redes (evita CORS con imágenes externas)
app.get('/api/public/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'Missing url parameter' });

    // Validar que sea una URL http/https
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'ViriatoTempo/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    // Solo permitir imágenes
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL is not an image' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (error) {
    console.error('Proxy image error:', error.message);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// SPA catch-all: rutas que no son API ni archivos estáticos → index.html
if (fs.existsSync(webDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 ViriatoTempo Public API running on port ${PORT}`);
  console.log(`📊 ${events.length} eventos, ${participants.length} participantes, ${results.length} resultados`);
});
