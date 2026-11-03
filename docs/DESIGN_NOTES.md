# Design Notes

## Core Rules
- Refresh interval: 15s with live countdown.
- Default visible trains: 4.
- Countdown labels:
  - <= 59s: "就到"
  - <= -8s: "已開"
  - otherwise: "X 分" (ceil minutes)
- Blink for "就到" / "已開".

## Tabs
- Line tabs order: 東鐵, 屯馬, 觀塘, 荃灣, 港島, 將軍澳, 東涌, 南港島, 機鐵, 迪士尼, 轉車.
- Tabs are sticky; board scrolls, no visible scrollbar.

## Transfer Tab (轉車)
- Shows interchange stations only.
- Each line group has a line-name header centered.
- No-service handling matches other tabs:
  - if one side has trains: show that side only
  - if both sides empty: show "暫無班次"
  - if data missing: show "更新中"
- Station card uses page background (no extra tint).

## Styling
- Station cards use line color for background and border.
- Train rows use platform color (per platform number).
- First row highlight removed; color handled by platform color.

