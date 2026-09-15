import type { ImgHTMLAttributes } from 'react';

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
};

export default function Image({ fill: _fill, priority: _priority, alt = '', ...props }: ImageProps) {
  return <img alt={alt} {...props} />;
}
