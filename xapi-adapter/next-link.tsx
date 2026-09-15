import type { AnchorHTMLAttributes, ReactNode } from 'react';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children?: ReactNode;
};

export default function Link({ href, children, ...props }: LinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
