import Image from 'next/image';
import { cn } from '@/lib/utils';

export function KanbyIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/kanby-avatar-v1.png"
      alt=""
      width={36}
      height={36}
      unoptimized
      className={cn('size-8 shrink-0 rounded-[10px]', className)}
    />
  );
}
