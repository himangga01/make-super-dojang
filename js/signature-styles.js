// 서명 형태 목록. 글꼴과 꾸밈 조합으로 한글·영문 각 24가지.
//
// font      글꼴 이름 (fonts.js SIGNATURE_FONTS)
// slant     기울기(도)
// rotate    전체 회전(도). 음수면 오른쪽이 올라간다
// deco      꾸밈: swoosh 흘림 밑줄, double 이중 밑줄, wave 물결 밑줄, tail 꼬리 획,
//           circle 동그라미, box 네모, dot 마침점, loop 고리 밑줄, strike 가로지르기
// initial   첫 글자 배율
// spacing   글자 간격(글자 크기 대비)
// vertical  세로 서명
// transform 'first-initial' → J. Doe, 'monogram' → JD

export const SIGNATURE_STYLES = {
  ko: [
    { id: 'ko-pen', label: '기본', font: 'Nanum Pen Script' },
    { id: 'ko-brush-swoosh', label: '흘림 밑줄', font: 'Nanum Brush Script', slant: 8, deco: 'swoosh' },
    { id: 'ko-dokdo-up', label: '올림체', font: 'East Sea Dokdo', rotate: -5 },
    { id: 'ko-dokdo-double', label: '이중 밑줄', font: 'Dokdo', deco: 'double' },
    { id: 'ko-gaegu-circle', label: '동그라미', font: 'Gaegu', deco: 'circle' },
    { id: 'ko-melody-wave', label: '물결 밑줄', font: 'Hi Melody', deco: 'wave' },
    { id: 'ko-gamja-initial', label: '첫 글자 강조', font: 'Gamja Flower', initial: 1.5 },
    { id: 'ko-yeon-box', label: '네모 테두리', font: 'Yeon Sung', deco: 'box' },
    { id: 'ko-poor-tail', label: '꼬리 획', font: 'Poor Story', deco: 'tail' },
    { id: 'ko-single-dot', label: '마침점', font: 'Single Day', deco: 'dot' },
    { id: 'ko-cute-tight', label: '촘촘하게', font: 'Cute Font', spacing: -0.06 },
    { id: 'ko-kirang-slant', label: '기울임', font: 'Kirang Haerang', slant: 12 },
    { id: 'ko-stylish-swoosh', label: '밑줄', font: 'Stylish', deco: 'swoosh' },
    { id: 'ko-bw', label: '또박또박', font: 'Black And White Picture' },
    { id: 'ko-pen-vertical', label: '세로 서명', font: 'Nanum Pen Script', vertical: true },
    { id: 'ko-brush-overlap', label: '겹침 흘림', font: 'Nanum Brush Script', spacing: -0.14, slant: 14 },
    { id: 'ko-dokdo-strike', label: '가로지르기', font: 'East Sea Dokdo', deco: 'strike' },
    { id: 'ko-dokdo-circle', label: '기운 동그라미', font: 'Dokdo', deco: 'circle', rotate: -4 },
    { id: 'ko-pen-loop', label: '고리 밑줄', font: 'Nanum Pen Script', deco: 'loop' },
    { id: 'ko-gaegu-wide', label: '넓은 간격', font: 'Gaegu', spacing: 0.28 },
    { id: 'ko-brush-initial', label: '첫 글자 + 밑줄', font: 'Nanum Brush Script', initial: 1.6, deco: 'swoosh', rotate: -4 },
    { id: 'ko-melody-tail', label: '꼬리 흘림', font: 'Hi Melody', deco: 'tail', slant: 8 },
    { id: 'ko-yeon-vertical', label: '세로 낙관', font: 'Yeon Sung', vertical: true, deco: 'box' },
    { id: 'ko-gamja-up-dot', label: '올림 마침점', font: 'Gamja Flower', rotate: -6, deco: 'dot' },
  ],
  en: [
    { id: 'en-vibes', label: 'Classic', font: 'Great Vibes' },
    { id: 'en-dancing-swoosh', label: 'Swoosh', font: 'Dancing Script', deco: 'swoosh' },
    { id: 'en-allura-double', label: 'Double line', font: 'Allura', slant: 4, deco: 'double' },
    { id: 'en-sacramento-loop', label: 'Loop', font: 'Sacramento', deco: 'loop' },
    { id: 'en-alex-tail', label: 'Tail', font: 'Alex Brush', deco: 'tail' },
    { id: 'en-dafoe-up', label: 'Rising', font: 'Mr Dafoe', rotate: -6 },
    { id: 'en-apple-dot', label: 'Full stop', font: 'Homemade Apple', deco: 'dot' },
    { id: 'en-caveat-box', label: 'Boxed', font: 'Caveat', deco: 'box' },
    { id: 'en-pinyon-initial', label: 'Big initial', font: 'Pinyon Script', initial: 1.45 },
    { id: 'en-herr-swoosh', label: 'Flowing', font: 'Herr Von Muellerhoff', deco: 'swoosh' },
    { id: 'en-monsieur', label: 'Elegant', font: 'Monsieur La Doulaise' },
    { id: 'en-aurore-wave', label: 'Wave', font: 'La Belle Aurore', deco: 'wave' },
    { id: 'en-kristi-strike', label: 'Cross stroke', font: 'Kristi', deco: 'strike' },
    { id: 'en-satisfy', label: 'Casual', font: 'Satisfy', slant: 4 },
    { id: 'en-parisienne-double', label: 'Formal', font: 'Parisienne', deco: 'double' },
    { id: 'en-yellowtail-up', label: 'Bold rise', font: 'Yellowtail', rotate: -5, deco: 'swoosh' },
    { id: 'en-rouge-initial', label: 'Initial + name', font: 'Rouge Script', transform: 'first-initial', deco: 'swoosh' },
    { id: 'en-delafield-tail', label: 'Long tail', font: 'Mrs Saint Delafield', deco: 'tail' },
    { id: 'en-cedarville-dot', label: 'Handwritten', font: 'Cedarville Cursive', deco: 'dot' },
    { id: 'en-reenie-circle', label: 'Circled', font: 'Reenie Beanie', deco: 'circle' },
    { id: 'en-marck-wide', label: 'Wide', font: 'Marck Script', spacing: 0.12 },
    { id: 'en-vibes-monogram', label: 'Monogram', font: 'Great Vibes', transform: 'monogram', deco: 'circle', size: 1.3 },
    { id: 'en-alex-initial', label: 'Initial swoosh', font: 'Alex Brush', initial: 1.5, deco: 'swoosh' },
    { id: 'en-dancing-loop', label: 'Rising loop', font: 'Dancing Script', deco: 'loop', rotate: -4 },
  ],
};
