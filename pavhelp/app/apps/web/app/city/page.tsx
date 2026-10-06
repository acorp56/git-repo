'use client';
import { useRouter } from 'next/navigation';
import { CityPicker } from '@/components/city-picker';
import { Top } from '@/components/ui';
import { useCity } from '@/lib/city';

export default function CityPage() {
  const [city, setCity] = useCity();
  const router = useRouter();
  return (
    <>
      <Top back="/" />
      <h1 className="page-title">Город</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Покажем запросы, клиники и банки крови рядом. Сейчас: {city}.
      </p>
      <CityPicker
        current={city}
        onPick={async (c, d) => {
          await setCity(c, d);
          router.push('/');
        }}
      />
    </>
  );
}
