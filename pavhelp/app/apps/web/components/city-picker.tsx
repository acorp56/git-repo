'use client';
// Выбор города: поиск по названию и региону, геолокация находит ближайший город и район.
import { CITIES, nearestArea, nearestCity } from '@pavhelp/core';
import { useMemo, useState } from 'react';

export function CityPicker({ current, onPick }: { current: string; onPick: (city: string, district?: string | null) => void }) {
  const [q, setQ] = useState('');
  const [geo, setGeo] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? CITIES.filter((c) => c.name.toLowerCase().includes(s) || c.region.toLowerCase().includes(s)) : CITIES).slice(0, 30);
  }, [q]);

  function locate() {
    if (!('geolocation' in navigator)) return setGeo('Браузер не умеет определять место');
    setGeo('Определяем…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pt: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        const { city, km } = nearestCity(pt);
        if (km > 60) return setGeo(`Рядом нет городов из списка. Ближайший — ${city.name}, ${Math.round(km)} км`);
        const area = nearestArea(city.name, pt);
        setGeo('');
        onPick(city.name, area?.name ?? null);
      },
      () => setGeo('Не получилось определить место. Выберите город из списка'),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  return (
    <div className="stack">
      <button type="button" className="btn" onClick={locate}>
        📍 Определить по геолокации
      </button>
      {geo && <span className="small muted">{geo}</span>}
      <label className="sr" htmlFor="city-q">
        Город или регион
      </label>
      <input id="city-q" className="input" placeholder="Город или регион" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card stack" role="listbox" aria-label="Города" style={{ maxHeight: 360, overflow: 'auto', gap: 4 }}>
        {list.length === 0 && <span className="muted small">Не нашли такой город. Мы добавим его, когда там появятся клиники.</span>}
        {list.map((c) => (
          <button
            key={c.name}
            type="button"
            role="option"
            aria-selected={c.name === current}
            className="row between city-opt"
            onClick={() => onPick(c.name)}
          >
            <span>
              {c.name}
              <span className="small muted"> · {c.region}</span>
            </span>
            {c.name === current && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
