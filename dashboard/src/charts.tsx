import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([BarChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, SVGRenderer])

export interface Theme {
  surface: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
  series: string[]
  seq: string[]
  gold: string
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function readTheme(): Theme {
  return {
    surface: cssVar('--surface'),
    ink: cssVar('--ink'),
    ink2: cssVar('--ink-2'),
    muted: cssVar('--muted'),
    grid: cssVar('--grid'),
    axis: cssVar('--axis'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--series-${i}`)),
    seq: [1, 2, 3, 4, 5, 6, 7].map((i) => cssVar(`--seq-${i}`)),
    gold: cssVar('--gold'),
  }
}

/** Re-read the CSS theme whenever the color scheme changes. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setTheme(readTheme())
    mq.addEventListener('change', update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', update)
      obs.disconnect()
    }
  }, [])
  return theme
}

export function EChart({ option, height, label }: { option: EChartsCoreOption; height: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    if (!ref.current) return
    chart.current = echarts.init(ref.current, undefined, { renderer: 'svg' })
    const ro = new ResizeObserver(() => chart.current?.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])
  return <div className="chart" role="img" aria-label={label} ref={ref} style={{ height }} />
}

/** Shared chrome: hairline grid, muted axis text, tooltip in surface colors. */
export function baseOption(t: Theme): EChartsCoreOption {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: 'inherit', color: t.ink2 },
    tooltip: {
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.grid,
      borderWidth: 1,
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: 'box-shadow: 0 6px 24px rgba(0,0,0,.12); border-radius: 8px;',
    },
  }
}

export function valueAxis(t: Theme, formatter?: (v: number) => string) {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    axisLabel: { color: t.muted, fontSize: 11, formatter },
  }
}

export function categoryAxis(t: Theme, data: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.ink2, fontSize: 11 },
    ...extra,
  }
}

export function legend(t: Theme) {
  return {
    top: 0,
    left: 0,
    icon: 'roundRect',
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    textStyle: { color: t.ink2, fontSize: 12 },
  }
}
