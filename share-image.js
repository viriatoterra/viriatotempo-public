// share-image.js — Server-side canvas rendering for social media share cards
// Light theme version — port of mobile/lib/shareCard.js renderCanvas()
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

// Manual letter-spacing — node-canvas 2.x doesn't reliably support ctx.letterSpacing
function fillTextSpaced(ctx, text, x, y, spacing = 0) {
  if (!spacing) { ctx.fillText(text, x, y); return; }
  const chars = text.split('');
  const widths = chars.map(c => ctx.measureText(c).width);
  const totalW = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cursorX;
  const align = ctx.textAlign;
  if (align === 'center') cursorX = x - totalW / 2;
  else if (align === 'right') cursorX = x - totalW;
  else cursorX = x;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursorX, y);
    cursorX += widths[i] + spacing;
  }
  ctx.textAlign = align;
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
    return (distance / (totalSeconds / 3600)).toFixed(1);
  }
  const paceSeconds = totalSeconds / distance;
  const mins = Math.floor(paceSeconds / 60);
  const secs = Math.floor(paceSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ==================== GPX TRACK MINIMAP ====================

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

  const pad = 24;
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

  // Light gray background
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#f3f4f6';
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Outer red glow
  ctx.beginPath();
  const first = project(points[0]);
  ctx.moveTo(first.px, first.py);
  for (let i = 1; i < points.length; i++) {
    const pt = project(points[i]);
    ctx.lineTo(pt.px, pt.py);
  }
  ctx.strokeStyle = 'rgba(230,57,70,0.18)';
  ctx.lineWidth = 12;
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
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Start marker (green)
  const startPt = project(points[0]);
  ctx.beginPath();
  ctx.arc(startPt.px, startPt.py, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Finish marker (dark)
  const endPt = project(points[points.length - 1]);
  ctx.beginPath();
  ctx.arc(endPt.px, endPt.py, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ==================== ELEVATION PROFILE ====================

function drawElevationProfile(ctx, points, x, y, w, h) {
  if (!points || points.length < 3) return false;

  const series = [];
  let cumKm = 0;
  let prev = null;
  let minEle = Infinity, maxEle = -Infinity;
  for (const p of points) {
    if (prev) cumKm += haversineKm(prev.lat, prev.lon, p.lat, p.lon);
    if (p.ele != null && !isNaN(p.ele)) {
      series.push({ km: cumKm, ele: p.ele });
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
    prev = p;
  }
  if (series.length < 3 || maxEle === minEle) return false;

  const totalKm = series[series.length - 1].km;
  const pad = 20;
  const padBottom = 40;
  const padLeft = 50;
  const areaX = x + padLeft;
  const areaY = y + pad;
  const areaW = w - padLeft - pad;
  const areaH = h - pad - padBottom;

  // Light background
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#f9fafb';
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Horizontal grid lines + elevation labels
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const yy = areaY + (areaH * i / 3);
    ctx.beginPath();
    ctx.moveTo(areaX, yy);
    ctx.lineTo(areaX + areaW, yy);
    ctx.stroke();

    const eleVal = Math.round(maxEle - (maxEle - minEle) * i / 3);
    ctx.font = '500 14px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'right';
    ctx.fillText(`${eleVal}m`, areaX - 6, yy + 4);
  }

  const project = (s) => ({
    px: areaX + (s.km / totalKm) * areaW,
    py: areaY + areaH - ((s.ele - minEle) / (maxEle - minEle)) * areaH,
  });

  // Filled area (red gradient)
  ctx.beginPath();
  const startP = project(series[0]);
  ctx.moveTo(startP.px, areaY + areaH);
  ctx.lineTo(startP.px, startP.py);
  for (let i = 1; i < series.length; i++) {
    const p = project(series[i]);
    ctx.lineTo(p.px, p.py);
  }
  ctx.lineTo(areaX + areaW, areaY + areaH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, areaY, 0, areaY + areaH);
  grad.addColorStop(0, 'rgba(230,57,70,0.4)');
  grad.addColorStop(1, 'rgba(230,57,70,0.05)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Top profile line
  ctx.beginPath();
  ctx.moveTo(startP.px, startP.py);
  for (let i = 1; i < series.length; i++) {
    const p = project(series[i]);
    ctx.lineTo(p.px, p.py);
  }
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Km labels on X axis
  ctx.font = '500 14px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.fillText('0 km', areaX, areaY + areaH + 22);
  ctx.fillText(`${Math.round(totalKm / 2)} km`, areaX + areaW / 2, areaY + areaH + 22);
  ctx.fillText(`${Math.round(totalKm)} km`, areaX + areaW, areaY + areaH + 22);

  return true;
}

// ==================== SPLITS TABLE ====================

function drawSplitsTable(ctx, splits, x, y, w, maxRows = 6) {
  if (!splits || splits.length === 0) return 0;

  const headerH = 36;
  const rowH = 38;
  const indicatorH = 32;
  const padBottom = 8;

  let visibleSplits;
  let showIndicator = false;
  let indicatorIdx = -1;
  let omittedCount = 0;
  if (splits.length <= maxRows) {
    visibleSplits = splits;
  } else if (maxRows >= 4) {
    const halfTop = Math.ceil(maxRows / 2);
    const halfBot = maxRows - halfTop;
    visibleSplits = [...splits.slice(0, halfTop), ...splits.slice(-halfBot)];
    showIndicator = true;
    indicatorIdx = halfTop;
    omittedCount = splits.length - maxRows;
  } else {
    visibleSplits = splits.slice(0, maxRows);
    showIndicator = true;
    indicatorIdx = visibleSplits.length;
    omittedCount = splits.length - maxRows;
  }

  const tableH = headerH + rowH * visibleSplits.length + (showIndicator ? indicatorH : 0) + padBottom;

  // Background
  roundRect(ctx, x, y, w, tableH, 16);
  ctx.fillStyle = '#f9fafb';
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Dark header
  roundRect(ctx, x, y, w, headerH, 16);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.fillRect(x, y + headerH - 16, w, 16);

  // Header text
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  const padL = 24;
  const colDistX = x + w * 0.45;
  const colTimeX = x + w - padL;
  fillTextSpaced(ctx, 'PUNTO', x + padL, y + 23, 2);
  fillTextSpaced(ctx, 'DISTANCIA', colDistX, y + 23, 2);
  ctx.textAlign = 'right';
  fillTextSpaced(ctx, 'TIEMPO', colTimeX, y + 23, 2);

  let cursorY = y + headerH;
  let visualIdx = 0;
  for (let i = 0; i < visibleSplits.length; i++) {
    if (showIndicator && i === indicatorIdx) {
      ctx.font = '500 13px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      ctx.fillText(`···  ${omittedCount} parciales más  ···`, x + w / 2, cursorY + 21);
      cursorY += indicatorH;
    }

    const s = visibleSplits[i];

    if (visualIdx % 2 === 1) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(x, cursorY, w, rowH);
    }

    // Name badge (truncate if long)
    let splitName = s.name || `Punto ${s.splitIndex + 1}`;
    ctx.font = 'bold 14px sans-serif';
    const maxBadgeW = colDistX - x - padL - 12;
    if (ctx.measureText(splitName).width > maxBadgeW - 18) {
      while (ctx.measureText(splitName + '…').width > maxBadgeW - 18 && splitName.length > 3) {
        splitName = splitName.slice(0, -1);
      }
      splitName = splitName + '…';
    }
    const labelW = ctx.measureText(splitName).width + 18;
    roundRect(ctx, x + padL, cursorY + 9, labelW, 22, 6);
    ctx.fillStyle = '#fef3c7';
    ctx.fill();
    ctx.fillStyle = '#92400e';
    ctx.textAlign = 'left';
    ctx.fillText(splitName, x + padL + 9, cursorY + 24);

    // Distance
    if (s.distance) {
      ctx.font = '500 16px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left';
      ctx.fillText(`${s.distance} km`, colDistX, cursorY + 24);
    }

    // Time (cumulative)
    const t = (s.cumulative || s.time || '—').split('.')[0];
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#1a1a2e';
    ctx.textAlign = 'right';
    fillTextSpaced(ctx, t, colTimeX, cursorY + 25, 1);

    cursorY += rowH;
    visualIdx++;
  }

  if (showIndicator && indicatorIdx === visibleSplits.length) {
    ctx.font = '500 13px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText(`···  ${omittedCount} parciales más  ···`, x + w / 2, cursorY + 21);
  }

  return tableH;
}

// ==================== LAPS TABLE ====================

function drawLapsTable(ctx, runnerLaps, x, y, w, maxRows = 6) {
  if (!runnerLaps || runnerLaps.length === 0) return 0;

  const headerH = 36;
  const rowH = 38;
  const indicatorH = 32;
  const padBottom = 8;

  let visibleLaps;
  let showIndicator = false;
  let indicatorIdx = -1;
  let omittedCount = 0;
  if (runnerLaps.length <= maxRows) {
    visibleLaps = runnerLaps;
  } else if (maxRows >= 4) {
    const halfTop = Math.ceil(maxRows / 2);
    const halfBot = maxRows - halfTop;
    visibleLaps = [...runnerLaps.slice(0, halfTop), ...runnerLaps.slice(-halfBot)];
    showIndicator = true;
    indicatorIdx = halfTop;
    omittedCount = runnerLaps.length - maxRows;
  } else {
    visibleLaps = runnerLaps.slice(0, maxRows);
    showIndicator = true;
    indicatorIdx = visibleLaps.length;
    omittedCount = runnerLaps.length - maxRows;
  }

  const tableH = headerH + rowH * visibleLaps.length + (showIndicator ? indicatorH : 0) + padBottom;

  roundRect(ctx, x, y, w, tableH, 16);
  ctx.fillStyle = '#f9fafb';
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.stroke();

  roundRect(ctx, x, y, w, headerH, 16);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.fillRect(x, y + headerH - 16, w, 16);

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  const padL = 24;
  const colTimeX = x + w * 0.5;
  const colCumX = x + w - padL;
  fillTextSpaced(ctx, 'VUELTA', x + padL, y + 23, 2);
  fillTextSpaced(ctx, 'T. VUELTA', colTimeX, y + 23, 2);
  ctx.textAlign = 'right';
  fillTextSpaced(ctx, 'ACUMULADO', colCumX, y + 23, 2);

  let cursorY = y + headerH;
  let visualIdx = 0;
  for (let i = 0; i < visibleLaps.length; i++) {
    if (showIndicator && i === indicatorIdx) {
      ctx.font = '500 13px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      ctx.fillText(`···  ${omittedCount} vueltas más  ···`, x + w / 2, cursorY + 21);
      cursorY += indicatorH;
    }

    const l = visibleLaps[i];

    if (visualIdx % 2 === 1) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(x, cursorY, w, rowH);
    }

    // Lap number badge (blue)
    const lapLabel = `V${l.lapNumber}`;
    ctx.font = 'bold 14px sans-serif';
    const labelW = ctx.measureText(lapLabel).width + 18;
    roundRect(ctx, x + padL, cursorY + 9, labelW, 22, 6);
    ctx.fillStyle = '#dbeafe';
    ctx.fill();
    ctx.fillStyle = '#1e40af';
    ctx.textAlign = 'left';
    ctx.fillText(lapLabel, x + padL + 9, cursorY + 24);

    // Lap time
    const lapT = (l.lapTime || '—').split('.')[0];
    ctx.font = '600 16px monospace';
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'left';
    fillTextSpaced(ctx, lapT, colTimeX, cursorY + 25, 1);

    // Cumulative
    const cumT = (l.cumulative || '—').split('.')[0];
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#1a1a2e';
    ctx.textAlign = 'right';
    fillTextSpaced(ctx, cumT, colCumX, cursorY + 25, 1);

    cursorY += rowH;
    visualIdx++;
  }

  if (showIndicator && indicatorIdx === visibleLaps.length) {
    ctx.font = '500 13px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText(`···  ${omittedCount} vueltas más  ···`, x + w / 2, cursorY + 21);
  }

  return tableH;
}

// ==================== MAIN RENDER ====================

export async function generateShareImage(detail, eventInfo, raceName, distance, posterUrl, gpxPoints, elevationGain, runnerLaps = null) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const isFinished = detail.status === 'Finalizado';
  const isCycling = CYCLING_TYPES.includes(eventInfo?.type);
  const hasGpx = gpxPoints && gpxPoints.length >= 2;
  const hasEle = hasGpx && gpxPoints.some(p => p.ele != null && !isNaN(p.ele));
  const splitsList = (detail.splits || []).filter(s => s && (s.cumulative || s.time));
  const lapsList = (runnerLaps || detail.laps || []).filter(l => l && (l.cumulative || l.lapTime));
  const hasSplits = splitsList.length > 0;
  const hasLaps = lapsList.length > 0;

  // ==================== WHITE BACKGROUND ====================
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ==================== HEADER: BRANDING ====================
  let cy = 100;
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = '#1a1a2e';
  fillTextSpaced(ctx, 'VIRIATO TEMPO', W / 2, cy, 4);
  cy += 22;

  // Red accent line
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, cy);
  ctx.lineTo(W / 2 + 60, cy);
  ctx.stroke();
  cy += 40;

  ctx.font = '500 14px sans-serif';
  ctx.fillStyle = '#9ca3af';
  fillTextSpaced(ctx, 'CRONOMETRAJE OFICIAL', W / 2, cy, 3);
  cy += 56;

  // ==================== POSTER ====================
  let posterImg = null;
  if (posterUrl) {
    try { posterImg = await loadImage(posterUrl); } catch { /* ignore */ }
  }

  if (posterImg) {
    const posterMaxH = 380;
    const posterMargin = 50;
    const posterW = W - posterMargin * 2;
    const posterRatio = posterImg.width / posterImg.height;
    const posterH = posterRatio > 1
      ? Math.min(posterW / posterRatio, posterMaxH)
      : posterMaxH;
    const posterX = posterMargin;
    const posterY = cy;

    // Card with shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, posterX, posterY, posterW, posterH, 24);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

    // Cover-fit poster inside rounded rect
    ctx.save();
    roundRect(ctx, posterX, posterY, posterW, posterH, 24);
    ctx.clip();
    const imgRatio = posterImg.width / posterImg.height;
    const cardRatio = posterW / posterH;
    let sx, sy, sw, sh;
    if (imgRatio > cardRatio) {
      sh = posterImg.height;
      sw = sh * cardRatio;
      sx = (posterImg.width - sw) / 2;
      sy = 0;
    } else {
      sw = posterImg.width;
      sh = sw / cardRatio;
      sx = 0;
      sy = (posterImg.height - sh) / 2;
    }
    ctx.drawImage(posterImg, sx, sy, sw, sh, posterX, posterY, posterW, posterH);
    ctx.restore();

    cy += posterH + 30;
  }

  // ==================== EVENT INFO ====================
  const dateStr = eventInfo.date ? new Date(eventInfo.date).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long'
  }).toUpperCase() : '';
  const locStr = (eventInfo.location || '').toUpperCase();
  const subline = [dateStr, locStr].filter(Boolean).join('   ·   ');
  if (subline) {
    ctx.font = '600 18px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    fillTextSpaced(ctx, subline, W / 2, cy, 2);
    cy += 44;
  }

  // Event name (wrapped, no manual spacing)
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#1a1a2e';
  const evNameY = wrapText(ctx, (eventInfo.name || 'EVENTO').toUpperCase(), W / 2, cy, W - 100, 50);
  cy = evNameY + 36;

  // Race badge (yellow)
  if (raceName) {
    ctx.font = 'bold 18px sans-serif';
    const raceLabel = raceName.toUpperCase();
    const tw = ctx.measureText(raceLabel).width + 60;
    roundRect(ctx, (W - tw) / 2, cy, tw, 38, 19);
    ctx.fillStyle = '#fef9c3';
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#713f12';
    ctx.textAlign = 'center';
    fillTextSpaced(ctx, raceLabel, W / 2, cy + 26, 1.5);
    cy += 64;
  }

  // Subtle divider
  cy += 16;
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, cy);
  ctx.lineTo(W - 100, cy);
  ctx.stroke();
  cy += 50;

  // ==================== RUNNER ====================
  const fullName = `${detail.firstName || ''} ${detail.lastName || ''}`.trim();
  ctx.font = 'bold 54px sans-serif';
  if (ctx.measureText(fullName).width > W - 80) {
    ctx.font = 'bold 42px sans-serif';
  }
  ctx.fillStyle = '#1a1a2e';
  ctx.textAlign = 'center';
  const nameEndY = wrapText(ctx, fullName.toUpperCase(), W / 2, cy, W - 60, 70);
  cy = nameEndY + 28;

  // Bib + team
  const subItems = [];
  if (detail.bib) subItems.push(`#${detail.bib}`);
  if (detail.team) subItems.push(detail.team);
  if (subItems.length > 0) {
    ctx.font = '500 22px sans-serif';
    ctx.fillStyle = '#6b7280';
    fillTextSpaced(ctx, subItems.join('   ·   '), W / 2, cy, 1);
    cy += 64;
  }

  // ==================== TIME ====================
  if (isFinished) {
    const displayTime = detail.officialTime || detail.netTime || detail.chipTime;
    const chipTime = displayTime ? displayTime.split('.')[0] : '—';
    ctx.font = 'bold 130px monospace';
    ctx.fillStyle = '#e63946';
    fillTextSpaced(ctx, chipTime, W / 2, cy + 110, 4);
    cy += 150;

    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#9ca3af';
    fillTextSpaced(ctx, 'TIEMPO OFICIAL', W / 2, cy, 3);
    cy += 50;

    // Position chips
    const chips = [];
    if (detail.position) chips.push({ value: `${detail.position}º`, label: 'GENERAL', isTop3: detail.position <= 3 });
    if (detail.category && detail.categoryPosition) {
      chips.push({ value: `${detail.categoryPosition}º`, label: detail.category, isTop3: detail.categoryPosition <= 3 });
    }
    if (detail.gender && detail.genderPosition) {
      const gLabel = detail.gender === 'female' ? 'FEMENINO' : 'MASCULINO';
      chips.push({ value: `${detail.genderPosition}º`, label: gLabel, isTop3: detail.genderPosition <= 3 });
    }

    if (chips.length > 0) {
      const chipH = 88;
      const chipGap = 18;
      const totalW = (W - 100);
      const chipMaxW = (totalW - chipGap * (chips.length - 1)) / chips.length;
      let chipX = (W - (chipMaxW * chips.length + chipGap * (chips.length - 1))) / 2;

      chips.forEach(chip => {
        roundRect(ctx, chipX, cy, chipMaxW, chipH, 18);
        ctx.fillStyle = chip.isTop3 ? '#fef9c3' : '#f9fafb';
        ctx.fill();
        ctx.strokeStyle = chip.isTop3 ? '#facc15' : '#e5e7eb';
        ctx.lineWidth = chip.isTop3 ? 2 : 1;
        ctx.stroke();

        ctx.font = 'bold 32px sans-serif';
        ctx.fillStyle = chip.isTop3 ? '#713f12' : '#1a1a2e';
        ctx.textAlign = 'center';
        fillTextSpaced(ctx, chip.value, chipX + chipMaxW / 2, cy + 42, 1);

        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = chip.isTop3 ? 'rgba(113,63,18,0.7)' : '#6b7280';
        let lab = chip.label;
        if (ctx.measureText(lab).width > chipMaxW - 16) {
          while (ctx.measureText(lab + '...').width > chipMaxW - 16 && lab.length > 3) {
            lab = lab.slice(0, -1);
          }
          lab = lab + '...';
        }
        fillTextSpaced(ctx, lab, chipX + chipMaxW / 2, cy + 70, 1.5);

        chipX += chipMaxW + chipGap;
      });
      cy += chipH + 36;
    }

    // Pace + distance + elevation
    const pace = calcPace(detail.officialTime || detail.netTime || detail.chipTime, distance, eventInfo?.type);
    const detailParts = [];
    if (pace) detailParts.push(isCycling ? `${pace} km/h` : `${pace} min/km`);
    if (distance) detailParts.push(`${distance} km`);
    if (elevationGain) detailParts.push(`D+ ${elevationGain} m`);
    if (detailParts.length > 0) {
      ctx.font = '500 18px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      ctx.fillText(detailParts.join('   ·   '), W / 2, cy + 22);
      cy += 60;
    }
  } else {
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = detail.status === 'DNF' ? '#ef4444' : '#9ca3af';
    ctx.textAlign = 'center';
    fillTextSpaced(ctx, detail.status === 'DNF' ? 'NO FINALIZÓ' : 'NO PRESENTADO', W / 2, cy + 60, 2);
    cy += 110;
  }

  // ==================== SPLITS / LAPS / GPX ====================
  const sectionMargin = 50;
  const sectionW = W - sectionMargin * 2;
  const footerTopY = H - 100;
  const rowH = 38;
  const headerH = 36;
  const sectionTitleH = 22 + 8;

  if (hasSplits) {
    let remainingH = footerTopY - cy;
    if (remainingH >= 100) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      fillTextSpaced(ctx, 'PARCIALES (RACE SPLITS)', W / 2, cy, 3);
      cy += sectionTitleH;

      remainingH = footerTopY - cy;
      const reserveBelow = (hasLaps ? 200 : 0) + (hasGpx ? 200 : 0);
      const realFit = Math.floor((remainingH - reserveBelow - headerH - 8) / rowH);
      const finalMaxRows = Math.max(splitsList.length <= 8 ? splitsList.length : Math.max(8, realFit), 2);

      const usedH = drawSplitsTable(ctx, splitsList, sectionMargin, cy, sectionW, finalMaxRows);
      cy += usedH + 20;
    }
  }

  if (hasLaps) {
    let remainingH = footerTopY - cy;
    if (remainingH >= 100) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      fillTextSpaced(ctx, 'VUELTAS', W / 2, cy, 3);
      cy += sectionTitleH;

      remainingH = footerTopY - cy;
      const reserveBelow = hasGpx ? 200 : 0;
      const realFit = Math.floor((remainingH - reserveBelow - headerH - 8) / rowH);
      const finalMaxRows = Math.max(lapsList.length <= 8 ? lapsList.length : Math.max(8, realFit), 2);

      const usedH = drawLapsTable(ctx, lapsList, sectionMargin, cy, sectionW, finalMaxRows);
      cy += usedH + 20;
    }
  }

  if (hasGpx) {
    let remainingH = footerTopY - cy;
    if (remainingH >= 200) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      const headerLabel = hasEle ? 'RECORRIDO Y PERFIL' : 'RECORRIDO';
      fillTextSpaced(ctx, headerLabel, W / 2, cy, 3);
      cy += 28;

      remainingH = footerTopY - cy;

      if (hasEle && remainingH >= 380) {
        const mapH = 200;
        const profileH = 160;
        drawTrackMinimap(ctx, gpxPoints, sectionMargin, cy, sectionW, mapH);
        cy += mapH + 14;
        drawElevationProfile(ctx, gpxPoints, sectionMargin, cy, sectionW, profileH);
        cy += profileH;
      } else if (hasEle) {
        const h = Math.min(remainingH - 16, 200);
        drawElevationProfile(ctx, gpxPoints, sectionMargin, cy, sectionW, h);
        cy += h;
      } else {
        const h = Math.min(remainingH - 16, 240);
        drawTrackMinimap(ctx, gpxPoints, sectionMargin, cy, sectionW, h);
        cy += h;
      }
    }
  }

  // ==================== FOOTER ====================
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'center';
  fillTextSpaced(ctx, 'VIRIATOTEMPO.COM', W / 2, H - 50, 3);

  return canvas.toBuffer('image/png');
}
