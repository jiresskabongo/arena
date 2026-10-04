import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireTenant } from '@/server/services/tenant';
import { getDesign } from '@/server/services/design';
import { DesignEditor, type SerializedDesign } from '@/components/app/designs/design-editor';

export default async function DesignEditorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('designs.editor');

  const ctx = await requireTenant();
  if (!ctx.organization) notFound();

  const design = await getDesign(ctx, id);
  if (!design) notFound();

  const payload: SerializedDesign = {
    id: design.id,
    name: design.name,
    type: design.type,
    format: design.format,
    width: design.width,
    height: design.height,
    version: design.version,
    background: JSON.parse(JSON.stringify(design.backgroundJson)),
    elements: JSON.parse(JSON.stringify(design.elementsJson)),
  };

  return (
    <div className="space-y-2">
      <h1 className="sr-only">{t('back')} : {design.name}</h1>
      <DesignEditor design={payload} locale={locale} />
    </div>
  );
}
