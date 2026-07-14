/**
 * Renders a standalone shields.io-style SVG badge for a single server's
 * token count. Self-contained (no external image/font requests) so it can
 * be saved and embedded directly in a README via a relative path, or piped
 * to a file.
 */

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Rough Verdana-11px text width estimate, matching shields.io's own heuristic
 * closely enough for a static badge (no font metrics available offline). */
function estimateTextWidth(text: string): number {
  return Math.round(text.length * 6.5 + 10);
}

/**
 * Illustrative severity thresholds (token count for this one server) purely
 * to pick a badge color, loosely modeled on shields.io's green/yellow/red
 * convention. Not a scientifically derived cutoff - adjust to taste.
 */
function colorForTokens(tokens: number): string {
  if (tokens < 300) return '#0ca30c'; // good
  if (tokens < 1000) return '#fab219'; // warning
  return '#d03b3b'; // critical
}

export interface BadgeOptions {
  label?: string;
}

/** Renders a shields.io-style "<label>: <serverName> | <tokens> tokens" SVG badge. */
export function renderBadge(serverName: string, tokens: number, options: BadgeOptions = {}): string {
  const label = options.label ?? `mcp-meter: ${serverName}`;
  const message = `${tokens.toLocaleString('en-US')} tokens`;
  const color = colorForTokens(tokens);

  const labelWidth = estimateTextWidth(label);
  const messageWidth = estimateTextWidth(message);
  const totalWidth = labelWidth + messageWidth;
  const height = 20;

  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="round">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#round)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${color}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="14">${escapeXml(label)}</text>
    <text x="${messageX}" y="14">${escapeXml(message)}</text>
  </g>
</svg>
`;
}
