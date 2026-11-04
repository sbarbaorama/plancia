// Disposizione affiancata degli appuntamenti di una giornata (vista settimana).

/**
 * layoutDay(items) → [{ item, col, cols }]
 * items: [{ startMin, endMin, ... }] in minuti dalla mezzanotte.
 * Gli appuntamenti che si sovrappongono (anche a catena) formano un gruppo: dentro il gruppo
 * ognuno riceve una colonna (la prima libera) e tutti dividono la larghezza in `cols` parti.
 * Un appuntamento che finisce esattamente quando inizia un altro non si sovrappone.
 */
export function layoutDay(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result = [];
  let group = [];
  let groupEnd = -Infinity;
  let columnsEnd = [];

  const closeGroup = () => {
    const cols = Math.max(1, columnsEnd.length);
    for (const r of group) r.cols = cols;
    group = [];
    columnsEnd = [];
  };

  for (const item of sorted) {
    if (item.startMin >= groupEnd && group.length) closeGroup();
    let col = columnsEnd.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(item.endMin);
    } else {
      columnsEnd[col] = item.endMin;
    }
    const placed = { item, col, cols: 1 };
    group.push(placed);
    result.push(placed);
    groupEnd = Math.max(groupEnd === -Infinity ? item.endMin : groupEnd, item.endMin);
  }
  if (group.length) closeGroup();
  return result;
}
