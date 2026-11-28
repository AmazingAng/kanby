import {
  MiniError,
  miniBody,
  miniBoundary,
  miniConfig,
  miniLogin,
  miniLogout,
  miniString,
} from '@/lib/weixin-mini';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return miniBoundary(async () => {
    miniConfig();
    const body = await miniBody(request);
    if (body.action === 'login')
      return miniLogin(request, miniString(body.code, 256));
    if (body.action === 'logout') return miniLogout(request);
    throw new MiniError(400, '未知的登录操作');
  });
}
