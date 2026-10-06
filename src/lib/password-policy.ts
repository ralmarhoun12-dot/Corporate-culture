export const PASSWORD_HINT = '١٠ أحرف على الأقل، وتشمل حرفًا كبيرًا وحرفًا صغيرًا ورقمًا ورمزًا (مثل ! @ #).';

export function passwordProblem(pw: string): string | null {
  const missing: string[] = [];
  if (pw.length < 10) missing.push('١٠ أحرف على الأقل');
  if (!/[A-Z]/.test(pw)) missing.push('حرف إنجليزي كبير');
  if (!/[a-z]/.test(pw)) missing.push('حرف إنجليزي صغير');
  if (!/[0-9]/.test(pw)) missing.push('رقم');
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push('رمز');
  return missing.length ? 'كلمة المرور تحتاج: ' + missing.join('، ') : null;
}

export function assertStrongPassword(pw: string) {
  const p = passwordProblem(pw);
  if (p) throw new Error(p);
}
