/* ==========================================================================
   SkyPulse India — frontend controller
   --------------------------------------------------------------------------
   Sections in this file:

     1.  Constants & state
     2.  Element lookup
     3.  Weather icons        — inline SVG; motion comes from style.css
     4.  Small UI helpers     — element building, number animation, announcing
     5.  Formatting
     6.  Input validation
     7.  Page state machine
     8.  Errors
     9.  API client
     10. Render: current weather & metrics
     11. Render: forecast cards
     12. Day selector
     13. CSV export
     14. Search
     15. Event listeners & bootstrap

   Security notes:
     * No API key exists here. The browser only calls this app's own /api.
     * Every value from the API is inserted with textContent, never innerHTML,
       so a weather description can never inject markup. The only innerHTML in
       the file writes the static icon strings defined in section 3.
   ========================================================================== */
'use strict';

(function () {
  /* ======================================================================
     1. Constants & state
     ====================================================================== */

  const API = {
    weather: (city) => `/api/weather?city=${encodeURIComponent(city)}`,
    csv: (city, days) =>
      `/api/forecast.csv?city=${encodeURIComponent(city)}&days=${encodeURIComponent(days)}`,
  };

  const DAY_OPTIONS = [1, 2, 3, 4, 5];
  const DEFAULT_DAYS = 5;
  const UNAVAILABLE = 'Not reported';

  /** True when the visitor asked their system to minimise animation. */
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    weather: null, // last successful payload
    lastQuery: '', // city of the last successful search
    days: DEFAULT_DAYS, // selected forecast length
    isLoading: false, // a weather request is in flight
    isExporting: false, // a CSV request is in flight
  };

  /* ======================================================================
     2. Element lookup
     ====================================================================== */

  const el = {};
  for (const id of [
    'search-form', 'city-input', 'search-button', 'search-icon', 'search-spinner',
    'search-button-label', 'input-error', 'live-status',
    'state-initial', 'state-loading', 'state-error', 'state-results', 'loading-message',
    'error-title', 'error-message', 'error-icon', 'retry-button', 'error-dismiss',
    'hero', 'location-name', 'location-meta', 'observed-at', 'cached-badge',
    'current-icon', 'current-temp', 'current-condition', 'current-feels', 'metrics-grid',
    'days-selector', 'export-button', 'export-icon', 'export-spinner', 'export-label',
    'export-feedback', 'forecast-grid', 'forecast-subtitle', 'forecast-note',
  ]) {
    el[id] = document.getElementById(id);
  }

  /* ======================================================================
     3. Weather icons
     Static, app-authored SVG keyed by OpenWeatherMap icon code. Moving
     parts carry `wi-*` classes that style.css animates, so shape and
     motion stay separate. Drawing them inline avoids image requests and
     keeps them sharp at every size.
     ====================================================================== */

  const ICON_SHAPES = {
    sun: `
      <g class="wi-spin" stroke="#f59e0b" stroke-width="3.2" stroke-linecap="round">
        <path d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4.2 4.2M44.8 44.8 49 49M49 15l-4.2 4.2M19.2 44.8 15 49"/>
      </g>
      <circle class="wi-pulse" cx="32" cy="32" r="12" fill="url(#g-sun)"/>`,

    moon: `
      <path class="wi-pulse" d="M38 12a20 20 0 1 0 14 34A22 22 0 0 1 38 12Z" fill="url(#g-moon)"/>
      <circle cx="47" cy="16" r="1.8" fill="#e2e8f0"/>
      <circle cx="54" cy="25" r="1.2" fill="#e2e8f0"/>`,

    cloud: `
      <path class="wi-cloud" d="M18 48h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 26.5 10 10 0 0 0 18 48Z" fill="url(#g-cloud)"/>`,

    sunCloud: `
      <g class="wi-spin" stroke="#f59e0b" stroke-width="2.6" stroke-linecap="round">
        <path d="M24 8v4.5M24 35.5V40M8 24h4.5M35.5 24H40M13 13l3 3M32 32l3 3M35 13l-3 3M16 32l-3 3"/>
      </g>
      <circle class="wi-pulse" cx="24" cy="24" r="8.5" fill="url(#g-sun)"/>
      <path class="wi-cloud" d="M26 52h22a8 8 0 0 0 .8-15.9A11.5 11.5 0 0 0 28.2 32 8.8 8.8 0 0 0 26 52Z" fill="url(#g-cloud)"/>`,

    rain: `
      <path class="wi-cloud" d="M18 42h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 20.5 10 10 0 0 0 18 42Z" fill="url(#g-cloud)"/>
      <g stroke="#38bdf8" stroke-width="3.4" stroke-linecap="round">
        <path class="wi-drop" d="M24 47v5"/>
        <path class="wi-drop" d="M32 47v7"/>
        <path class="wi-drop" d="M40 47v5"/>
      </g>`,

    heavyRain: `
      <path class="wi-cloud" d="M18 40h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 18.5 10 10 0 0 0 18 40Z" fill="url(#g-storm)"/>
      <g stroke="#0ea5e9" stroke-width="3.4" stroke-linecap="round">
        <path class="wi-drop" d="M21 45v6"/>
        <path class="wi-drop" d="M29 45v8"/>
        <path class="wi-drop" d="M37 45v6"/>
        <path class="wi-drop" d="M45 45v8"/>
      </g>`,

    drizzle: `
      <path class="wi-cloud" d="M18 40h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 18.5 10 10 0 0 0 18 40Z" fill="url(#g-cloud)"/>
      <g stroke="#7dd3fc" stroke-width="3" stroke-linecap="round">
        <path class="wi-drop" d="M25 46v3.5"/>
        <path class="wi-drop" d="M33 46v4.5"/>
        <path class="wi-drop" d="M41 46v3.5"/>
      </g>`,

    thunder: `
      <path class="wi-cloud" d="M18 38h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 16.5 10 10 0 0 0 18 38Z" fill="url(#g-storm)"/>
      <path class="wi-bolt" d="M33 40h8l-6 8h6l-12 14 4-12h-6Z" fill="#fbbf24"/>`,

    snow: `
      <path class="wi-cloud" d="M18 40h26a9 9 0 0 0 1-17.9A13 13 0 0 0 20.6 18.5 10 10 0 0 0 18 40Z" fill="url(#g-cloud)"/>
      <g stroke="#93c5fd" stroke-width="2.6" stroke-linecap="round">
        <path class="wi-flake" d="M24 46v8M20.5 48l7 4M27.5 48l-7 4"/>
        <path class="wi-flake" d="M40 46v8M36.5 48l7 4M43.5 48l-7 4"/>
      </g>`,

    mist: `
      <g stroke="#94a3b8" stroke-width="4" stroke-linecap="round">
        <path class="wi-mist" d="M12 24h40"/>
        <path class="wi-mist" d="M16 34h34"/>
        <path class="wi-mist" d="M12 44h40"/>
        <path class="wi-mist" d="M20 54h26"/>
      </g>`,
  };

  /** Gradients shared by every icon instance. */
  const ICON_DEFS = `
    <defs>
      <linearGradient id="g-sun" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fbbf24"/><stop offset="100%" stop-color="#f59e0b"/>
      </linearGradient>
      <linearGradient id="g-moon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f1f5f9"/><stop offset="100%" stop-color="#94a3b8"/>
      </linearGradient>
      <linearGradient id="g-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#cbd5e1"/>
      </linearGradient>
      <linearGradient id="g-storm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#94a3b8"/>
      </linearGradient>
    </defs>`;

  const ICON_BY_CODE = {
    '01d': 'sun',       '01n': 'moon',
    '02d': 'sunCloud',  '02n': 'moon',
    '03d': 'cloud',     '03n': 'cloud',
    '04d': 'cloud',     '04n': 'cloud',
    '09d': 'drizzle',   '09n': 'drizzle',
    '10d': 'rain',      '10n': 'rain',
    '11d': 'thunder',   '11n': 'thunder',
    '13d': 'snow',      '13n': 'snow',
    '50d': 'mist',      '50n': 'mist',
  };

  /**
   * Choose an icon shape for a condition.
   * Falls back to the OpenWeatherMap condition-id ranges when the icon code
   * is missing, so a card is never left blank.
   */
  function pickIconShape(condition) {
    const byCode = ICON_BY_CODE[String(condition?.icon || '')];
    if (byCode) {
      // Upgrade to the heavier artwork for intense rain.
      return byCode === 'rain' && Number(condition?.id) >= 502 ? 'heavyRain' : byCode;
    }

    const id = Number(condition?.id);
    if (id >= 200 && id < 300) return 'thunder';
    if (id >= 300 && id < 400) return 'drizzle';
    if (id >= 500 && id < 532) return id >= 502 ? 'heavyRain' : 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'mist';
    if (id === 800) return 'sun';
    return 'cloud';
  }

  /** Build an inline SVG weather icon that fills its container. */
  function createWeatherIcon(condition) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('focusable', 'false');

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = condition?.description || condition?.main || 'Weather icon';
    svg.appendChild(title);

    // Static markup only — never interpolated with API text.
    svg.insertAdjacentHTML('beforeend', ICON_DEFS + ICON_SHAPES[pickIconShape(condition)]);
    return svg;
  }

  /**
   * Map a condition to one of the hero gradient themes defined in style.css.
   * The icon code's trailing "d"/"n" tells us day or night.
   */
  function pickHeroTheme(condition) {
    const code = String(condition?.icon || '');
    const isNight = code.endsWith('n');
    const shape = pickIconShape(condition);

    if (shape === 'thunder') return 'thunder';
    if (shape === 'rain' || shape === 'heavyRain' || shape === 'drizzle') return 'rain';
    if (shape === 'snow') return 'snow';
    if (shape === 'mist') return 'mist';
    if (shape === 'cloud' || shape === 'sunCloud') return 'clouds';
    return isNight ? 'clear-night' : 'clear-day';
  }

  /** Small line icon used as a metric label glyph. */
  const GLYPHS = {
    thermometer: 'M12 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z',
    droplet: 'M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z',
    wind: 'M3 8h11a3 3 0 1 0-3-3M3 16h14a3 3 0 1 1-3 3M3 12h18',
    gauge: 'M12 13 15.5 9.5M4 18a9 9 0 1 1 16 0',
    rain: 'M7 15h10a4.5 4.5 0 0 0 .4-8.95A6.5 6.5 0 0 0 5.6 7.5 5 5 0 0 0 7 15ZM9 19v1.5M12 19v2.5M15 19v1.5',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z',
    cloud: 'M7 18h10a4.5 4.5 0 0 0 .4-8.95A6.5 6.5 0 0 0 5.6 10.5 5 5 0 0 0 7 18Z',
    clock: 'M12 7v5l3.5 2M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z',
    sunrise: 'M12 4v4M5.6 10.6 8 13M18.4 10.6 16 13M3 18h18M8.5 18a3.5 3.5 0 0 1 7 0',
    warning: 'M12 9v4M12 17h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z',
    notFound: 'M20 10.5c0 5.25-8 11-8 11s-8-5.75-8-11a8 8 0 1 1 16 0ZM9.5 10.5h5',
    offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a9 9 0 0 1 4-2.3M19 13a9 9 0 0 0-7-2.9M12 20h.01',
  };

  function createGlyph(pathData, size = 14) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.insertAdjacentHTML('beforeend', `<path d="${pathData}"/>`);
    return svg;
  }

  /* ======================================================================
     4. Small UI helpers
     ====================================================================== */

  /** Create an element with an optional class list and text content. */
  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /** Announce an asynchronous change to screen-reader users. */
  function announce(message) {
    el['live-status'].textContent = message;
  }

  /**
   * Count a number up to its final value.
   *
   * Used for the headline temperature. Negative values and decimals are
   * handled, and with reduced motion the value is simply set at once.
   */
  function animateNumber(node, to, { decimals = 1, duration = 750 } = {}) {
    if (!Number.isFinite(to)) {
      node.textContent = '–';
      return;
    }
    if (REDUCED_MOTION) {
      node.textContent = to.toFixed(decimals);
      return;
    }

    const from = 0;
    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      // Ease-out cubic: fast at first, settling gently on the final value.
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = (from + (to - from) * eased).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  /* ======================================================================
     5. Formatting
     ====================================================================== */

  /** Format a number with a unit, or return null when there is no value. */
  function formatValue(value, unit = '', { decimals = null } = {}) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return String(value);

    const text =
      decimals === null
        ? numeric.toLocaleString('en-IN')
        : numeric.toLocaleString('en-IN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          });
    return unit ? `${text}${unit}` : text;
  }

  /** "2026-10-14" -> "Wed, 14 Oct" */
  function formatShortDate(isoDate) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }

  /** Compass label for a wind bearing in degrees. */
  function formatBearing(degrees) {
    if (!Number.isFinite(degrees)) return '';
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return points[Math.round(degrees / 45) % 8];
  }

  /* ======================================================================
     6. Input validation
     Mirrors the server-side rule in server/utils/validation.js. The server
     validates again — this copy only saves a pointless round trip.
     ====================================================================== */

  const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’()-]*$/u;

  function validateCity(raw) {
    const city = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!city) return { ok: false, message: 'Please enter a city name to search.' };
    if (city.length < 2) return { ok: false, message: 'Please enter at least 2 characters.' };
    if (city.length > 60) return { ok: false, message: 'That city name is too long.' };
    if (!CITY_PATTERN.test(city)) {
      return { ok: false, message: 'Please use letters, spaces, hyphens or apostrophes only.' };
    }
    return { ok: true, city };
  }

  function setInputError(message) {
    const node = el['input-error'];
    if (!message) {
      node.classList.add('hidden');
      node.textContent = '';
      el['city-input'].removeAttribute('aria-invalid');
      return;
    }
    node.textContent = message;
    node.classList.remove('hidden');
    el['city-input'].setAttribute('aria-invalid', 'true');
  }

  /* ======================================================================
     7. Page state machine
     Exactly one of the four sections is visible at any moment.
     ====================================================================== */

  function showState(name) {
    const sections = {
      initial: el['state-initial'],
      loading: el['state-loading'],
      error: el['state-error'],
      results: el['state-results'],
    };

    for (const [key, node] of Object.entries(sections)) {
      const isActive = key === name;
      node.classList.toggle('hidden', !isActive);
      if (key === 'loading') node.setAttribute('aria-hidden', String(!isActive));
    }

    // A hidden element has no width, so the day selector can only be measured
    // once the results are actually on screen. Waiting one frame lets the
    // browser lay the section out first.
    if (name === 'results') requestAnimationFrame(() => moveSelectorThumb());
  }

  /* ======================================================================
     8. Errors
     ====================================================================== */

  /** Map an error code to a title, an icon and whether retrying makes sense. */
  function describeError(code, retryable) {
    switch (code) {
      case 'EMPTY_CITY':
      case 'INVALID_CITY':
        return { title: 'Check the city name', glyph: 'warning', retry: false };
      case 'CITY_NOT_FOUND':
        return { title: 'City not found', glyph: 'notFound', retry: false };
      case 'INVALID_DAYS':
        return { title: 'Invalid forecast length', glyph: 'warning', retry: false };
      case 'NETWORK_ERROR':
      case 'OFFLINE':
        return { title: 'No connection', glyph: 'offline', retry: true };
      case 'UPSTREAM_TIMEOUT':
        return { title: 'The request timed out', glyph: 'clock', retry: true };
      case 'RATE_LIMITED':
      case 'UPSTREAM_RATE_LIMITED':
        return { title: 'Too many requests', glyph: 'clock', retry: true };
      case 'GEOCODING_BLOCKED':
        return { title: 'Location search not configured', glyph: 'warning', retry: false };
      case 'MISSING_API_KEY':
      case 'INVALID_API_KEY':
        return { title: 'Weather service not configured', glyph: 'warning', retry: false };
      case 'FORECAST_UNAVAILABLE':
        return { title: 'Forecast unavailable', glyph: 'warning', retry: true };
      case 'UPSTREAM_UNAVAILABLE':
        return { title: 'Weather service unavailable', glyph: 'warning', retry: true };
      default:
        return { title: 'Something went wrong', glyph: 'warning', retry: Boolean(retryable) };
    }
  }

  function showError(error) {
    const { title, glyph, retry } = describeError(error.code, error.retryable);

    el['error-title'].textContent = title;
    el['error-message'].textContent = error.message;
    el['error-icon'].replaceChildren(createGlyph(GLYPHS[glyph] || GLYPHS.warning, 28));

    // Offer a retry only when one could plausibly succeed.
    const canRetry = retry && Boolean(error.retryCity);
    el['retry-button'].classList.toggle('hidden', !canRetry);
    el['retry-button'].dataset.city = error.retryCity || '';

    // A failed search must never leave stale results looking current.
    state.weather = null;
    showState('error');
    announce(`${title}. ${error.message}`);
  }

  /* ======================================================================
     9. API client
     ====================================================================== */

  /**
   * Fetch JSON from our own backend, normalising every failure into one
   * shape: { code, message, retryable }.
   */
  async function requestJson(url) {
    if (!navigator.onLine) {
      throw {
        code: 'OFFLINE',
        message: 'You appear to be offline. Please check your connection and try again.',
        retryable: true,
      };
    }

    let response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw {
        code: 'NETWORK_ERROR',
        message: 'We could not reach the weather server. Please check your connection and try again.',
        retryable: true,
      };
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || !body?.ok) {
      throw {
        code: body?.error?.code || 'HTTP_ERROR',
        message:
          body?.error?.message ||
          `The weather server replied with an unexpected error (status ${response.status}).`,
        retryable: body?.error?.retryable ?? response.status >= 500,
      };
    }
    return body.data;
  }

  /* ======================================================================
     10. Render: current weather & metrics
     ====================================================================== */

  /** Build the list of metric tiles from the current-weather payload. */
  function buildMetricList(current, units) {
    const precip = current.precipitation || {};

    const wind = (() => {
      const speed = formatValue(current.windSpeed, ` ${units.windSpeed}`, { decimals: 1 });
      if (!speed) return null;
      const bearing = formatBearing(current.windDirection);
      return bearing ? `${speed} ${bearing}` : speed;
    })();

    const minMax =
      current.tempMin === null && current.tempMax === null
        ? null
        : `${formatValue(current.tempMin, '°', { decimals: 1 }) ?? '–'} / ${
            formatValue(current.tempMax, '°', { decimals: 1 }) ?? '–'
          }`;

    return [
      { label: 'Feels like', glyph: 'thermometer', value: formatValue(current.feelsLike, ' °C', { decimals: 1 }) },
      { label: 'Min / Max', glyph: 'thermometer', value: minMax },
      { label: 'Humidity', glyph: 'droplet', value: formatValue(current.humidity, '%') },
      { label: 'Wind', glyph: 'wind', value: wind },
      { label: 'Pressure', glyph: 'gauge', value: formatValue(current.pressure, ' hPa') },
      { label: 'Precipitation', glyph: 'rain', value: formatValue(precip.totalMm, ' mm', { decimals: 1 }) },
      { label: 'Cloud cover', glyph: 'cloud', value: formatValue(current.cloudiness, '%') },
      {
        label: 'Visibility',
        glyph: 'eye',
        value: current.visibility === null ? null : formatValue(current.visibility / 1000, ' km', { decimals: 1 }),
      },
      {
        label: 'Sunrise / Sunset',
        glyph: 'sunrise',
        value:
          current.sunrise?.time && current.sunset?.time
            ? `${current.sunrise.time} / ${current.sunset.time}`
            : null,
      },
    ];
  }

  function renderMetrics(current, units) {
    const grid = el['metrics-grid'];
    grid.replaceChildren();

    buildMetricList(current, units).forEach((metric, index) => {
      const card = h('div', 'metric');
      card.style.setProperty('--i', String(index)); // drives the stagger in CSS

      const label = h('dt', 'metric__label');
      label.append(createGlyph(GLYPHS[metric.glyph]), h('span', '', metric.label));

      // Missing data is labelled as missing — never replaced with a guess.
      const hasValue = metric.value !== null && metric.value !== undefined;
      const value = h(
        'dd',
        `metric__value${hasValue ? '' : ' is-missing'}`,
        hasValue ? metric.value : UNAVAILABLE
      );

      card.append(label, value);
      grid.appendChild(card);
    });
  }

  function renderCurrent(data) {
    const { location, current, units } = data;

    // Theme the hero gradient to match the weather.
    el.hero.dataset.weather = pickHeroTheme(current.condition);

    el['location-name'].textContent = location.name || data.query;

    const place = [location.state, location.country].filter(Boolean).join(', ');
    const coords = `${location.latitude.toFixed(2)}°N, ${location.longitude.toFixed(2)}°E`;
    el['location-meta'].textContent = place ? `${place} · ${coords}` : coords;

    el['observed-at'].textContent = current.observedAt
      ? `Local time ${current.observedAt.time} · ${formatShortDate(current.observedAt.date)}`
      : 'Observation time not reported';

    el['cached-badge'].classList.toggle('hidden', !data.cached);

    animateNumber(el['current-temp'], current.temperature);

    el['current-condition'].textContent =
      current.condition.description || current.condition.main || UNAVAILABLE;

    const feels = formatValue(current.feelsLike, ' °C', { decimals: 1 });
    el['current-feels'].textContent = feels ? `Feels like ${feels}` : 'Feels-like not reported';

    el['current-icon'].replaceChildren(createWeatherIcon(current.condition));

    renderMetrics(current, units);
  }

  /* ======================================================================
     11. Render: forecast cards
     ====================================================================== */

  /**
   * Work out the temperature span across the days on screen, so each card's
   * range bar can be drawn on a shared scale and days become comparable.
   * Returns null when there are not enough temperatures to build a scale.
   */
  function getTemperatureScale(days) {
    const lows = days.map((day) => day.tempMin).filter(Number.isFinite);
    const highs = days.map((day) => day.tempMax).filter(Number.isFinite);
    if (lows.length === 0 || highs.length === 0) return null;

    const min = Math.min(...lows);
    const max = Math.max(...highs);
    // A flat span would divide by zero; widen it slightly instead.
    return max === min ? { min: min - 1, max: max + 1 } : { min, max };
  }

  /** The bar showing where this day sits within the period's temperature span. */
  function createRangeBar(day, scale) {
    const track = h('div', 'trange');
    if (!scale || !Number.isFinite(day.tempMin) || !Number.isFinite(day.tempMax)) return track;

    const span = scale.max - scale.min;
    const start = ((day.tempMin - scale.min) / span) * 100;
    // Keep a minimum width so a very narrow day is still visible.
    const width = Math.max(((day.tempMax - day.tempMin) / span) * 100, 8);

    const fill = h('span', 'trange__fill');
    fill.style.setProperty('--range-start', `${Math.min(start, 100 - width)}%`);
    fill.style.setProperty('--range-width', `${width}%`);

    track.appendChild(fill);
    return track;
  }

  function createForecastCard(day, units, scale, index) {
    const card = h('article', 'fcard');
    card.style.setProperty('--i', String(index)); // drives the stagger in CSS

    /* --- head: weekday, date, icon, description --- */
    const head = h('div', 'fcard__head');
    head.appendChild(h('p', 'fcard__day', day.weekday));
    head.appendChild(h('p', 'fcard__date', formatShortDate(day.date)));

    const icon = h('div', 'fcard__icon');
    icon.appendChild(createWeatherIcon(day.condition));
    head.appendChild(icon);

    head.appendChild(
      h('p', 'fcard__desc', day.condition.description || day.condition.main || UNAVAILABLE)
    );

    /* --- body: temperatures, range bar, supporting stats --- */
    const body = h('div', 'fcard__body');

    const temps = h('p', 'fcard__temps');
    temps.appendChild(h('span', 'fcard__max', formatValue(day.tempMax, '°', { decimals: 0 }) ?? '–'));
    temps.appendChild(h('span', 'fcard__min', formatValue(day.tempMin, '°', { decimals: 0 }) ?? '–'));
    temps.appendChild(h('span', 'fcard__scale', 'max / min'));
    body.appendChild(temps);

    body.appendChild(createRangeBar(day, scale));

    const stats = h('dl', '');
    const rows = [
      { label: 'Avg temp', value: formatValue(day.tempAvg, ' °C', { decimals: 1 }) },
      { label: 'Humidity', value: formatValue(day.humidity, '%') },
      { label: 'Rain', value: formatValue(day.precipitationMm, ' mm', { decimals: 1 }) },
      { label: 'Chance', value: formatValue(day.precipitationChance, '%') },
      { label: 'Wind', value: formatValue(day.windSpeedAvg, ` ${units.windSpeed}`, { decimals: 1 }) },
    ];

    for (const row of rows) {
      const line = h('div', 'fstat');
      const hasValue = row.value !== null && row.value !== undefined;
      line.append(h('dt', '', row.label), h('dd', hasValue ? '' : 'is-missing', hasValue ? row.value : 'N/A'));
      stats.appendChild(line);
    }
    body.appendChild(stats);

    // Partial days (fewer than eight 3-hour slots) are flagged, so a narrower
    // range is not mistaken for a forecast error.
    if (Number.isFinite(day.intervals) && day.intervals < 8) {
      body.appendChild(h('p', 'fcard__partial', `Partial day · ${day.intervals} of 8 intervals`));
    }

    card.append(head, body);
    return card;
  }

  function renderForecast() {
    const data = state.weather;
    if (!data) return;

    const available = data.forecast.days.length;
    // The selector can ask for more days than the API returned (which happens
    // late in the day); clamp so no empty placeholders appear.
    const shown = Math.min(state.days, available);
    const days = data.forecast.days.slice(0, shown);
    const scale = getTemperatureScale(days);

    const grid = el['forecast-grid'];
    grid.replaceChildren();
    days.forEach((day, index) => grid.appendChild(createForecastCard(day, data.units, scale, index)));

    const dayWord = shown === 1 ? 'day' : 'days';
    el['forecast-subtitle'].textContent =
      shown < state.days
        ? `Showing ${shown} ${dayWord} — only ${available} days are available right now`
        : `Next ${shown} ${dayWord} for ${data.location.name}`;

    el['forecast-note'].textContent = data.forecast.note;

    syncDaysSelector();
  }

  /* ======================================================================
     12. Day selector
     A radio group, so arrow keys work natively. The highlight behind the
     active segment is one element that slides, rather than five
     backgrounds switching on and off.
     ====================================================================== */

  let selectorThumb = null;

  function buildDaysSelector() {
    const container = el['days-selector'];
    container.replaceChildren();

    selectorThumb = h('span', 'days__thumb');
    selectorThumb.setAttribute('aria-hidden', 'true');
    container.appendChild(selectorThumb);

    for (const value of DAY_OPTIONS) {
      const option = h('label', 'day');
      option.title = `${value} day forecast`;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'forecast-days';
      input.value = String(value);
      input.checked = value === state.days;

      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.days = value;
        renderForecast();
        hideExportFeedback();
        announce(`Showing a ${value} day forecast.`);
      });

      option.append(input, h('span', '', String(value)), h('span', 'day__unit', 'd'));
      container.appendChild(option);
    }

    syncDaysSelector();

    // Segment widths change with the viewport, so the highlight is
    // re-measured whenever the control resizes. Both paths are registered:
    // the observer catches layout changes the window event does not (such as
    // a sidebar opening), and the window event still works where observer
    // callbacks are delayed.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => moveSelectorThumb()).observe(container);
    }
    window.addEventListener('resize', () => moveSelectorThumb());
  }

  /** Reflect the selected value on every segment, then move the highlight. */
  function syncDaysSelector() {
    for (const option of el['days-selector'].querySelectorAll('.day')) {
      const input = option.querySelector('input');
      const isActive = Number(input.value) === state.days;
      input.checked = isActive;
      option.classList.toggle('is-active', isActive);
    }
    moveSelectorThumb();
  }

  /**
   * Size and position the sliding highlight over the active segment.
   *
   * The segment cannot be measured while its section is hidden or before the
   * browser has laid it out, in which case offsetWidth reads 0. Rather than
   * depend on exact timing, the measurement simply retries on the next frame
   * until it succeeds — which covers first render, web fonts arriving late,
   * and the results section becoming visible.
   */
  function moveSelectorThumb(attempt = 0) {
    const active = el['days-selector'].querySelector('.day.is-active');
    if (!selectorThumb || !active) return;

    if (active.offsetWidth === 0) {
      if (attempt < 20) requestAnimationFrame(() => moveSelectorThumb(attempt + 1));
      return;
    }

    selectorThumb.style.width = `${active.offsetWidth}px`;
    selectorThumb.style.left = `${active.offsetLeft}px`;
    // Revealed only after a real measurement, so it never flashes at the
    // wrong position on load.
    selectorThumb.classList.add('is-ready');
  }

  /* ======================================================================
     13. CSV export
     ====================================================================== */

  function hideExportFeedback() {
    const node = el['export-feedback'];
    node.className = 'export-feedback hidden';
    node.textContent = '';
  }

  function showExportFeedback(message, kind) {
    const node = el['export-feedback'];
    node.textContent = message;
    node.className = `export-feedback export-feedback--${kind === 'error' ? 'error' : 'ok'}`;
    announce(message);
  }

  function setExporting(isExporting) {
    state.isExporting = isExporting;
    el['export-button'].disabled = isExporting;
    el['export-spinner'].classList.toggle('hidden', !isExporting);
    el['export-icon'].classList.toggle('hidden', isExporting);
    el['export-label'].textContent = isExporting ? 'Preparing…' : 'Export CSV';
  }

  /**
   * Download the CSV for the currently selected duration.
   *
   * The file is fetched rather than linked directly, so an error response can
   * be shown in the page instead of the browser navigating to a JSON error.
   */
  async function exportCsv() {
    if (state.isExporting || !state.weather) return;

    const city = state.lastQuery;
    const days = Math.min(state.days, state.weather.forecast.days.length);

    setExporting(true);
    hideExportFeedback();

    try {
      const response = await fetch(API.csv(city, days), { headers: { Accept: 'text/csv' } });

      if (!response.ok) {
        let message = `The export failed (status ${response.status}). Please try again.`;
        try {
          const body = await response.json();
          if (body?.error?.message) message = body.error.message;
        } catch {
          /* a non-JSON error body keeps the default message */
        }
        showExportFeedback(message, 'error');
        return;
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        showExportFeedback('The export came back empty. Please try again.', 'error');
        return;
      }

      // Prefer the filename the server chose.
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="?([^"]+)"?/i.exec(disposition);
      const filename = match ? match[1] : 'weather-forecast.csv';

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Release the blob once the browser has started the save.
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      const dayWord = days === 1 ? 'day' : 'days';
      showExportFeedback(`Downloaded ${filename} with ${days} ${dayWord} of forecast.`, 'success');
    } catch {
      showExportFeedback(
        navigator.onLine
          ? 'We could not download the CSV. Please try again.'
          : 'You appear to be offline, so the CSV could not be downloaded.',
        'error'
      );
    } finally {
      setExporting(false);
    }
  }

  /* ======================================================================
     14. Search
     ====================================================================== */

  function setLoading(isLoading, city) {
    state.isLoading = isLoading;
    // Disabling the button is what prevents duplicate submissions.
    el['search-button'].disabled = isLoading;
    el['city-input'].readOnly = isLoading;
    el['search-spinner'].classList.toggle('hidden', !isLoading);
    el['search-icon'].classList.toggle('hidden', isLoading);
    el['search-button-label'].textContent = isLoading ? 'Searching…' : 'Search';
    el['search-button'].setAttribute('aria-busy', String(isLoading));

    if (isLoading && city) {
      el['loading-message'].textContent = `Fetching the latest weather for ${city}…`;
    }
  }

  /** Run a search. Requests happen only here — never on a keystroke. */
  async function search(rawCity) {
    if (state.isLoading) return; // ignore duplicate submissions

    const result = validateCity(rawCity);
    if (!result.ok) {
      setInputError(result.message);
      el['city-input'].focus();
      announce(result.message);
      return;
    }
    setInputError(null);

    const city = result.city;
    setLoading(true, city);
    showState('loading');
    hideExportFeedback();
    announce(`Searching for ${city}.`);

    try {
      const data = await requestJson(API.weather(city));

      state.weather = data;
      state.lastQuery = city;
      // Keep the chosen length, but never above what the API returned.
      state.days = Math.min(state.days, data.forecast.days.length);

      renderCurrent(data);
      renderForecast();
      showState('results');

      const temp = formatValue(data.current.temperature, '', { decimals: 1 });
      announce(
        `Weather for ${data.location.name}: ${temp ?? 'unknown'} degrees Celsius, ${
          data.current.condition.description || 'conditions not reported'
        }.`
      );
    } catch (error) {
      showError({ ...error, retryCity: city });
    } finally {
      setLoading(false);
    }
  }

  /* ======================================================================
     15. Event listeners & bootstrap
     ====================================================================== */

  el['search-form'].addEventListener('submit', (event) => {
    event.preventDefault(); // Enter and the button both arrive here
    search(el['city-input'].value);
  });

  // Clear a stale validation message as the user starts fixing it.
  // This handler performs no network work.
  el['city-input'].addEventListener('input', () => {
    if (!el['input-error'].classList.contains('hidden')) setInputError(null);
  });

  for (const button of document.querySelectorAll('[data-example-city]')) {
    button.addEventListener('click', () => {
      el['city-input'].value = button.dataset.exampleCity;
      search(button.dataset.exampleCity);
    });
  }

  el['export-button'].addEventListener('click', exportCsv);

  el['retry-button'].addEventListener('click', (event) => {
    const city = event.currentTarget.dataset.city;
    if (city) search(city);
  });

  el['error-dismiss'].addEventListener('click', () => {
    showState(state.weather ? 'results' : 'initial');
    el['city-input'].focus();
  });

  window.addEventListener('online', () => announce('Connection restored.'));
  window.addEventListener('offline', () =>
    announce('You are offline. Searches will fail until the connection returns.')
  );

  buildDaysSelector();
  showState('initial');
})();
