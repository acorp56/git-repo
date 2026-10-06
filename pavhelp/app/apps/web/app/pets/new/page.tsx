'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { emptyPet, PetForm, type PetFormValue } from '@/components/pet-form';
import { Top, useRequireLogin } from '@/components/ui';
import { api, ApiError, type Pet } from '@/lib/api';
import { useCity } from '@/lib/city';
import { useSession } from '@/lib/session';

export default function NewPet() {
  const ready = useRequireLogin();
  const { me, reload } = useSession();
  const [city] = useCity();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function save(f: PetFormValue) {
    setBusy(true);
    setError('');
    try {
      const pet = await api<Pet>('/pets', {
        body: {
          ...f,
          sex: f.sex || null,
          chip: f.chip || null,
          housing: f.housing || null,
          med: [
            ...(f.vacDate ? [{ kind: 'vac', date: f.vacDate }] : []),
            ...(f.rabDate ? [{ kind: 'rab', date: f.rabDate }] : []),
          ],
        },
      });
      // Сдача крови до Павхелпа: дата учитывается сразу, капли — после подтверждения клиникой.
      if (f.lastDonation) await api(`/pets/${pet.id}/donations`, { body: { date: f.lastDonation } });
      await reload();
      // Новый донор: три шага подготовки к первому SOS.
      router.push(pet.donorEnabled ? `/pets/${pet.id}/start` : '/profile');
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Top back="/profile" />;
  return (
    <>
      <Top back="/profile" />
      <h1 className="page-title">Новый питомец</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Проверим, может ли он стать донором. Требования обновляются сразу, пока вы заполняете анкету.
      </p>
      {error && <p className="alarm" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <PetForm initial={emptyPet(city, me?.district)} withMed submitLabel="Сохранить" busy={busy} errors={errors} onSubmit={save} />
    </>
  );
}
