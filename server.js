import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.use(express.json({ limit: '25mb' }));

// ============ DATA ============
let events = [];
let participants = [];
let results = [];

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
    console.log(`📂 Datos cargados: ${events.length} eventos, ${participants.length} participantes, ${results.length} resultados`);
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

    // Guardar a disco para persistir entre reinicios de Render
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf-8');

    console.log(`🔄 Sync: ${events.length} ev, ${participants.length} part, ${results.length} res`);
    res.json({ message: 'Datos sincronizados', events: events.length, participants: participants.length, results: results.length });
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
      })),
      status: new Date(e.date) >= now ? 'upcoming' : 'completed',
      totalParticipants: participants.filter(p => p.eventId === e.id).length,
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
      })),
      categories: (event.categories || []).map(c => ({
        name: c.name,
        gender: c.gender,
        minAge: c.minAge,
        maxAge: c.maxAge,
      })),
      status: new Date(event.date) >= now ? 'upcoming' : 'completed',
      totalParticipants: eventParticipants.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

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
      return {
        bib: r.bib,
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        team: p.team || null,
        category: p.category || null,
        province: p.province || null,
        isLocal: p.isLocal || false,
        chipTime: r.chipTime || null,
        netTime: r.netTime || null,
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
    enriched.forEach(r => {
      if (r.status === 'Finalizado') {
        r.position = pos++;
      } else {
        r.position = null;
      }
    });

    res.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        type: event.type,
        distance: event.distance,
        races: (event.races || []).map(r => ({ id: r.id, name: r.name, distance: r.distance })),
      },
      results: enriched,
      total: enriched.length,
      totalFinished: enriched.filter(r => r.status === 'Finalizado').length,
    });
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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    events: events.length,
    participants: participants.length,
    results: results.length,
  });
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
