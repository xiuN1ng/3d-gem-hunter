export const CUTTING_TOOLS = Object.freeze({
  saw: Object.freeze({
    id: 'saw',
    label: '金刚砂轮',
    shortLabel: '砂轮锯',
    subtitle: '高速径向锯切',
    duration: 3700,
    glyph: '◉'
  }),
  wire: Object.freeze({
    id: 'wire',
    label: '金刚线锯',
    shortLabel: '金刚线',
    subtitle: '柔性张力切割',
    duration: 4550,
    glyph: '⌁'
  }),
  burr: Object.freeze({
    id: 'burr',
    label: '开窗磨头',
    shortLabel: '磨头',
    subtitle: '局部开窗取样',
    duration: 3250,
    glyph: '✦'
  })
});

export const CUTTING_TOOL_LIST = Object.freeze(Object.values(CUTTING_TOOLS));
