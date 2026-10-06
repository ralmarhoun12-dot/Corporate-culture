import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from 'react';
import { installSiteCloud } from '@/lib/site-cloud';

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "الثقافة المؤسسية | وزارة التعليم" },
      { name: "description", content: "منصة الثقافة المؤسسية التفاعلية وبرنامج رفاه وسلاسل البازل التوعوية." },
      { property: "og:title", content: "الثقافة المؤسسية | وزارة التعليم" },
      { property: "og:description", content: "منصة الثقافة المؤسسية التفاعلية وبرنامج رفاه وسلاسل البازل التوعوية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => installSiteCloud(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }), [queryClient]);
  return (
    <iframe
      src="/site.html"
      title="الثقافة المؤسسية"
      className="fixed inset-0 h-[100dvh] w-full border-0"
    />
  );
}
