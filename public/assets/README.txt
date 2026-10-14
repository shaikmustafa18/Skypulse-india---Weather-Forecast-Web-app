Static assets for the SkyPulse India weather app.

favicon.svg  Application icon referenced from public/index.html.

Weather icons are not stored here: they are drawn as inline SVG by
public/app.js (see SVG_DEFS / ICON_BY_CODE), which avoids extra network
requests and keeps the icons crisp at any size.
