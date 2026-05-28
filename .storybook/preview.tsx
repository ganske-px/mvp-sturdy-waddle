import { Toaster } from '@/components/ui/sonner';
import type { Decorator, Preview } from '@storybook/nextjs';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect } from 'react';
import '../app/globals.css';

function ThemeSync({ theme }: { theme: 'light' | 'dark' }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
  return null;
}

const withTheme: Decorator = (Story, ctx) => {
  const theme = (ctx.globals.theme as 'light' | 'dark') ?? 'light';
  return (
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false}>
      <ThemeSync theme={theme} />
      <div className="font-sans text-foreground bg-background min-h-[200px] p-6">
        <Story />
      </div>
      <Toaster />
    </ThemeProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: 'oklch(1 0 0)' },
        { name: 'dark', value: 'oklch(0.145 0 0)' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Color scheme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withTheme],
};

export default preview;
