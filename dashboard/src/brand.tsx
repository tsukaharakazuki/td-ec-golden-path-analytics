// Treasure AI brand mark and line icons, kept inline so the single-file build needs no extra assets or packages.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 155.43 105.02"><defs><linearGradient id="a" x1="26.5" y1="78.52" x2="116.36" y2="-11.35" gradientUnits="userSpaceOnUse"><stop offset=".03" stop-color="#ff86b4"/><stop offset=".04" stop-color="#fa84b7"/><stop offset=".16" stop-color="#c572dd"/><stop offset=".25" stop-color="#a468f5"/><stop offset=".31" stop-color="#9864ff"/><stop offset=".38" stop-color="#8470ff"/><stop offset=".68" stop-color="#3d9cff"/><stop offset=".89" stop-color="#11b8ff"/><stop offset="1" stop-color="#00c3ff"/></linearGradient><linearGradient id="b" x1="87.78" y1="17.35" x2="87.78" y2="-12.19" gradientUnits="userSpaceOnUse"><stop offset=".07" stop-color="#fff"/><stop offset=".89" stop-color="#00baff"/></linearGradient><linearGradient id="c" x1="121.2" y1="15.53" x2="170.87" y2="15.53" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".89" stop-color="#30c4ff"/></linearGradient><linearGradient id="d" x1="84.53" y1="59.64" x2="143.97" y2="70.74" gradientUnits="userSpaceOnUse"><stop offset=".03" stop-color="#7b32dc"/><stop offset=".98" stop-color="#32bdff"/></linearGradient></defs><path d="M83.02,102.82l70.21-70.21c2.93-2.93,2.93-7.69,0-10.62l-18.44-18.44C132.52,1.28,129.43,0,126.21,0H29.22C26,0,22.91,1.28,20.64,3.56L2.2,21.99c-2.93,2.93-2.93,7.69,0,10.62l70.21,70.21c2.93,2.93,7.69,2.93,10.62,0Z" fill="url(#a)"/><path d="M20.13,4.07c2.54-2.54,6.18-3.64,9.7-2.92l121.91,24.78c2.43.49,3.58,3.07,2.68,5.14,1.66-2.87,1.27-6.6-1.18-9.06l-18.44-18.44c-2.28-2.28-5.36-3.55-8.58-3.55H29.22c-3.22,0-6.31,1.28-8.58,3.56l-.51.51Z" fill="url(#b)" opacity=".4"/><path d="M128.59,5.35l-7.14,14.42,30.29,6.15c2.43.49,3.58,3.07,2.68,5.14,1.66-2.87,1.27-6.6-1.18-9.06l-18.44-18.44c-2.28-2.28-5.36-3.55-8.58-3.55h-.94c2.75,0,4.54,2.88,3.32,5.35Z" fill="url(#c)" opacity=".6"/><path d="M154.42,31.06c.9-2.06-.25-4.64-2.68-5.14l-30.29-6.15-40.65,82.12c-1.14,2.3-3.72,3.25-5.96,2.56,2.72,1.12,5.97.58,8.18-1.63l70.21-70.21c.47-.47.86-1,1.19-1.56h0Z" fill="url(#d)"/></svg>`

export const BRAND_ICON = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`

export type IconName = 'overview' | 'golden' | 'attribution' | 'rfm' | 'loyal' | 'ads' | 'email' | 'quality' | 'upload' | 'github' | 'lock'

// Path data follows lucide (ISC) at 24px / 2px stroke, matching the catalog viewer's icon set.
const PATHS: Record<IconName, string[]> = {
  overview: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  golden: ['M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15', 'M6 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  attribution: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  rfm: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  loyal: ['M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.29l4.28-3.67a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.74H5.81a1 1 0 0 1-.96-.74L2.01 6.01a.5.5 0 0 1 .8-.52l4.28 3.67a1 1 0 0 0 1.52-.29z', 'M5 21h14'],
  ads: ['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'],
  email: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  quality: ['M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z', 'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5', 'M3 12c0 1.66 4 3 9 3s9-1.34 9-3'],
  upload: ['M12 17V3', 'm6 11 6 6 6-6', 'M19 21H5'],
  github: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
