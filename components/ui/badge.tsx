import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase whitespace-nowrap transition-colors [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-primary/20 bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary/15 text-secondary-foreground',
        outline: 'border-border bg-card text-foreground',
        muted: 'chip-gray',
        info: 'chip-blue',
        'dark-blue': 'chip-dark-blue',
        success: 'chip-green',
        warning: 'chip-yellow',
        destructive: 'chip-red',
        purple: 'chip-purple',
      },
      size: {
        default: 'h-5 px-2',
        sm: 'h-4 px-1.5 text-[0.625rem]',
        lg: 'h-6 px-2.5 text-xs normal-case tracking-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
