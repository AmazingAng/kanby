'use client';

/* oxlint-disable next/no-html-link-for-pages -- vinext RSC Link navigation is unstable on the Worker runtime; force document navigation. */

import { LayoutGrid, LogOut, Settings, Sparkles } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { appPath } from '@/lib/app-path';
import { cn } from '@/lib/utils';

export type AppUser = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
};

export function KanbyMark({ href = '/app' }: { href?: string }) {
  return (
    <a
      href={appPath(href)}
      className="flex items-center gap-2.5"
      aria-label="Kanby 首页"
    >
      <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-background">
        <Sparkles className="size-4" />
      </span>
      <span className="text-[15px] font-bold tracking-[-0.03em]">kanby</span>
    </a>
  );
}

export function AppHeader({
  user,
  active,
}: {
  user: AppUser;
  active: 'gateway' | 'settings' | 'board';
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <KanbyMark />
        <nav
          className="flex items-center gap-1 rounded-full border border-ink/10 bg-card p-1"
          aria-label="主导航"
        >
          <a
            href={appPath('/app')}
            aria-label="项目"
            aria-current={active === 'gateway' ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-subtle transition-colors hover:text-ink',
              active === 'gateway' &&
                'bg-ink text-background hover:text-background',
            )}
          >
            <LayoutGrid className="size-3.5" />
            <span className="hidden sm:inline">项目</span>
          </a>
          <a
            href={appPath('/settings')}
            aria-label="设置"
            aria-current={active === 'settings' ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-subtle transition-colors hover:text-ink',
              active === 'settings' &&
                'bg-ink text-background hover:text-background',
            )}
          >
            <Settings className="size-3.5" />
            <span className="hidden sm:inline">设置</span>
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden text-right sm:block">
            <p className="max-w-32 truncate text-xs font-medium">{user.name}</p>
            <p className="text-[10px] text-ink-faint">@{user.login}</p>
          </div>
          <Avatar size="sm">
            <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
            <AvatarFallback className="bg-acid font-semibold text-ink">
              {user.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <form action={appPath('/api/auth/logout')} method="post">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-ink-faint"
              aria-label="退出登录"
            >
              <LogOut />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
