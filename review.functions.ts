import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const INSTRUCTIONS = `أنت مساعد لمدير مشروع "الثقافة المؤسسية" في وزارة التعليم. ستستلم تفاصيل أعمال ومشاركات قدّمتها المعلمات.
اكتب بالعربية الفصحى وبإيجاز، بنص عادي دون جداول، بهذه الأقسام:
الملخص: (3-5 أسطر)
أبرز الملاحظات: (نقاط تبدأ بـ "-")
نقاط القوة: (نقاط)
ما يحتاج مراجعة أو متابعة: (نقاط، واذكر اسم المعلمة إن وُجد)
توصيات للمدير: (نقاط عملية)
لا تخترع معلومات غير موجودة في النص. حدّ الإجابة 400 كلمة تقريبًا.`;

export const summarizeWork = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ text: z.string().trim().min(10).max(40000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
    if (!isAdmin) throw new Error('هذه الميزة لمدير المشروع فقط');
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error('خدمة الذكاء الاصطناعي غير مهيأة');
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { streamText } = await import('ai');
    const provider = createOpenAI({
      baseURL: 'https://ai.gateway.lovable.dev/v1',
      apiKey,
      headers: { 'Lovable-API-Key': apiKey, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' },
    });
    let failure: unknown = null;
    const result = streamText({
      model: provider.responses('openai/gpt-6-astra'),
      system: INSTRUCTIONS,
      messages: [{ role: 'user', content: data.text }],
      maxRetries: 0,
      onError: ({ error }) => { failure = error; },
      providerOptions: { openai: {
        forceReasoning: true, reasoningEffort: 'low', reasoningSummary: 'auto',
        store: false, include: ['reasoning.encrypted_content'],
      } },
    });
    let text = '';
    try { text = await result.text; } catch (e) { failure = e; }
    if (failure || !text.trim()) {
      const status = (failure as { statusCode?: number } | null)?.statusCode;
      if (status === 429) throw new Error('الخدمة مشغولة حاليًا، حاولي بعد قليل.');
      if (status === 402) throw new Error('نفد رصيد الذكاء الاصطناعي في مساحة العمل.');
      if (status === 403) throw new Error('الوصول إلى خدمة الذكاء الاصطناعي مرفوض حاليًا.');
      console.error(failure);
      throw new Error('تعذّر إنشاء الملخص.');
    }
    return { summary: text.trim() };
  });
