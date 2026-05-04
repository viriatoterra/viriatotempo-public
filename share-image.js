// share-image.js — Server-side canvas rendering for social media share cards
// Mirrors the client-side shareCard.js but uses node-canvas
import { createCanvas, loadImage } from 'canvas';

const W = 1080;
const H = 1920;

const CYCLING_TYPES = ['mtb', 'gravel', 'mtb_gravel'];

// ==================== HELPERS ====================

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
  return yy;
}

function calcPace(chipTime, distance, eventType) {
  if (!chipTime || !distance) return null;
  const parts = chipTime.split(':');
  const secParts = (parts[2] || '0').split('.');
  const totalSeconds = (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(secParts[0]);
  if (totalSeconds <= 0) return null;

  if (CYCLING_TYPES.includes(eventType)) {
    const totalHours = totalSeconds / 3600;
    return (distance / totalHours).toFixed(1);
  }

  const paceSeconds = totalSeconds / distance;
  const mins = Math.floor(paceSeconds / 60);
  const secs = Math.floor(paceSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function drawStatBox(ctx, x, y, w, h, value, label, accentColor) {
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Accent line at top
  ctx.save();
  roundRect(ctx, x + 16, y, w - 32, 3, 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
  ctx.restore();

  // Value
  ctx.textAlign = 'center';
  ctx.font = 'bold 42px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(value, x + w / 2, y + 62);

  // Label
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(label, x + w / 2, y + h - 18);
}

function drawTrackMinimap(ctx, points, x, y, w, h) {
  if (!points || points.length < 2) return;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const latRange = maxLat - minLat || 0.001;
  const lonRange = maxLon - minLon || 0.001;
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos(midLat * Math.PI / 180);
  const realW = lonRange * lonScale;
  const realH = latRange;

  const pad = 20;
  const areaW = w - pad * 2;
  const areaH = h - pad * 2;
  const scale = Math.min(areaW / realW, areaH / realH);
  const drawW = realW * scale;
  const drawH = realH * scale;
  const offX = x + pad + (areaW - drawW) / 2;
  const offY = y + pad + (areaH - drawH) / 2;

  const project = (p) => ({
    px: offX + (p.lon - minLon) * lonScale * scale,
    py: offY + drawH - (p.lat - minLat) * scale,
  });

  // Background
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Glow
  ctx.beginPath();
  const first = project(points[0]);
  ctx.moveTo(first.px, first.py);
  for (let i = 1; i < points.length; i++) {
    const pt = project(points[i]);
    ctx.lineTo(pt.px, pt.py);
  }
  ctx.strokeStyle = 'rgba(59,130,246,0.2)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Track line
  ctx.beginPath();
  ctx.moveTo(first.px, first.py);
  for (let i = 1; i < points.length; i++) {
    const pt = project(points[i]);
    ctx.lineTo(pt.px, pt.py);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Start marker (green)
  const startPt = project(points[0]);
  ctx.beginPath();
  ctx.arc(startPt.px, startPt.py, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Finish marker (red)
  const endPt = project(points[points.length - 1]);
  ctx.beginPath();
  ctx.arc(endPt.px, endPt.py, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ==================== MAIN RENDER ====================

export async function generateShareImage(detail, eventInfo, raceName, distance, posterUrl, gpxPoints, elevationGain) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // --- Base dark background ---
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, W, H);

  // --- Poster as full background ---
  let posterImg = null;
  if (posterUrl) {
    try {
      posterImg = await loadImage(posterUrl);
    } catch { /* ignore poster load failure */ }
  }

  if (posterImg) {
    const imgRatio = posterImg.width / posterImg.height;
    const canvasRatio = W / H;
    let sx, sy, sw, sh;
    if (imgRatio > canvasRatio) {
      sh = posterImg.height;
      sw = sh * canvasRatio;
      sx = (posterImg.width - sw) / 2;
      sy = 0;
    } else {
      sw = posterImg.width;
      sh = sw / canvasRatio;
      sx = 0;
      sy = (posterImg.height - sh) / 2;
    }
    ctx.drawImage(posterImg, sx, sy, sw, sh, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(0.5, '#0d0d1a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ==================== CENTRAL RESULT CARD ====================
  const cardMargin = 50;
  const cardW = W - cardMargin * 2;
  const cardX = cardMargin;

  const splitsCount = Math.min((detail.splits || []).length, 8);
  const extraSplits = (detail.splits || []).length > 8;
  let estimatedH = 500;
  if (raceName) estimatedH += 58;
  if (detail.category) estimatedH += 40;
  if (detail.genderPosition) estimatedH += 40;
  if (detail.team) estimatedH += 40;
  if (splitsCount > 0) estimatedH += 66 + splitsCount * 34 + (extraSplits ? 30 : 0);
  const hasGpx = gpxPoints && gpxPoints.length >= 2;
  if (hasGpx) estimatedH += 380;
  const cardH = Math.max(estimatedH, 500);
  const cardY = Math.min(320, (H - cardH - 160) / 2);

  // Card background (glassmorphism)
  roundRect(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fillStyle = 'rgba(13,13,26,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();

  roundRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, 31);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ---- Event name ----
  let cy = cardY + 60;
  ctx.textAlign = 'center';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#e63946';
  const nameEndY = wrapText(ctx, (eventInfo.name || 'Evento').toUpperCase(), W / 2, cy, cardW - 80, 44);
  cy = nameEndY + 16;

  // Date + location
  const dateStr = eventInfo.date ? new Date(eventInfo.date).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric'
  }) : '';
  const locStr = eventInfo.location || '';
  const subline = [dateStr, locStr].filter(Boolean).join('  ·  ');
  if (subline) {
    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(subline, W / 2, cy + 20);
    cy += 50;
  } else {
    cy += 14;
  }

  // Race badge
  if (raceName) {
    cy += 10;
    ctx.font = 'bold 20px sans-serif';
    const raceLabel = raceName.toUpperCase();
    const tw = ctx.measureText(raceLabel).width + 40;
    roundRect(ctx, (W - tw) / 2, cy, tw, 34, 17);
    ctx.fillStyle = 'rgba(230,57,70,0.25)';
    ctx.fill();
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e63946';
    ctx.textAlign = 'center';
    ctx.fillText(raceLabel, W / 2, cy + 24);
    cy += 58;
  } else {
    cy += 20;
  }

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 60, cy);
  ctx.lineTo(cardX + cardW - 60, cy);
  ctx.stroke();
  cy += 30;

  // Runner name
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  const runnerEndY = wrapText(ctx, `${detail.firstName} ${detail.lastName}`, W / 2, cy + 40, cardW - 100, 60);
  cy = runnerEndY + 20;

  // Bib badge
  ctx.font = 'bold 22px sans-serif';
  const bibStr = `DORSAL #${detail.bib}`;
  const bibW = ctx.measureText(bibStr).width + 32;
  roundRect(ctx, (W - bibW) / 2, cy, bibW, 34, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'center';
  ctx.fillText(bibStr, W / 2, cy + 24);
  cy += 60;

  // Stats
  if (detail.status === 'Finalizado') {
    const boxW = 280;
    const boxH = 110;
    const gap = 18;
    const totalBoxW = boxW * 3 + gap * 2;
    const startX = (W - totalBoxW) / 2;
    const chipTime = detail.chipTime ? detail.chipTime.split('.')[0] : '--';
    const isCycling = CYCLING_TYPES.includes(eventInfo?.type);
    const pace = calcPace(detail.chipTime, distance, eventInfo?.type);

    drawStatBox(ctx, startX, cy, boxW, boxH,
      detail.position ? `${detail.position}º` : '--', 'POSICIÓN', '#e63946');
    drawStatBox(ctx, startX + boxW + gap, cy, boxW, boxH,
      chipTime, 'TIEMPO', '#3b82f6');
    drawStatBox(ctx, startX + (boxW + gap) * 2, cy, boxW, boxH,
      pace || '--', isCycling ? 'VEL. KM/H' : 'RITMO /KM', '#f77f00');
    cy += boxH + 30;
  } else {
    const statusText = detail.status === 'DNF' ? 'NO FINALIZADO (DNF)' : 'NO PRESENTADO (DNS)';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = detail.status === 'DNF' ? '#ef4444' : '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText(statusText, W / 2, cy + 50);
    cy += 100;
  }

  // Category / Gender / Team
  if (detail.category) {
    const catLine = detail.categoryPosition
      ? `${detail.category}  ·  ${detail.categoryPosition}º de categoría`
      : detail.category;
    ctx.font = '26px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(catLine, W / 2, cy + 10);
    cy += 40;
  }

  if (detail.genderPosition) {
    const gLabel = detail.gender === 'male' ? 'Masculino' : 'Femenino';
    ctx.font = '26px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`${gLabel}  ·  ${detail.genderPosition}º`, W / 2, cy + 10);
    cy += 40;
  }

  if (detail.team) {
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(detail.team, W / 2, cy + 10);
    cy += 40;
  }

  // Splits
  const splits = detail.splits || [];
  if (splits.length > 0) {
    cy += 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 80, cy);
    ctx.lineTo(cardX + cardW - 80, cy);
    ctx.stroke();
    cy += 28;

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('TIEMPOS PARCIALES', W / 2, cy);
    cy += 28;

    const maxSplits = Math.min(splits.length, 8);
    const splitsAreaX = cardX + 80;
    const splitsAreaW = cardW - 160;

    for (let i = 0; i < maxSplits; i++) {
      const s = splits[i];
      const splitTime = (s.cumulative || s.time) ? (s.cumulative || s.time).split('.')[0] : '--';
      const splitName = s.name || `Punto ${s.splitIndex + 1}`;

      ctx.textAlign = 'left';
      ctx.font = '22px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(splitName, splitsAreaX, cy + 4);

      ctx.textAlign = 'right';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(splitTime, splitsAreaX + splitsAreaW, cy + 4);

      cy += 34;
    }

    if (splits.length > maxSplits) {
      ctx.textAlign = 'center';
      ctx.font = '18px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(`+${splits.length - maxSplits} más`, W / 2, cy + 4);
      cy += 30;
    }
  }

  // GPX Track Minimap
  if (hasGpx) {
    cy += 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 80, cy);
    ctx.lineTo(cardX + cardW - 80, cy);
    ctx.stroke();
    cy += 28;

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('RECORRIDO', W / 2, cy);
    cy += 24;

    const mapH = 280;
    drawTrackMinimap(ctx, gpxPoints, cardX + 60, cy, cardW - 120, mapH);
    cy += mapH + 16;

    const infoParts = [];
    if (distance) infoParts.push(`${distance} km`);
    if (elevationGain) infoParts.push(`D+ ${elevationGain} m`);
    if (infoParts.length > 0) {
      ctx.font = '22px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText(infoParts.join('    '), W / 2, cy);
      cy += 30;
    }
  }

  // ==================== TOP BRANDING ====================
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('VIRIATO TEMPO', W / 2, 180);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('POWERED BY VIRIATO TERRA', W / 2, 214);

  // ==================== BOTTOM ====================
  ctx.font = '22px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'center';
  ctx.fillText('viriatotempo.onrender.com', W / 2, H - 80);

  return canvas.toBuffer('image/png');
}
