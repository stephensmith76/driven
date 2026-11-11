import qrcode from 'qrcode-generator'

/** A QR code drawn as inline SVG (no network, so it works at a table with bad wifi). */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const cells: string[] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) cells.push(`M${x},${y}h1v1h-1z`)
  return (
    <svg role="img" aria-label={`QR code for ${text}`} width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <path d={cells.join('')} fill="#000" />
    </svg>
  )
}
