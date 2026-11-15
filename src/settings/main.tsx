import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/base.css';
import './settings.css';
import { initTheme } from '../shared/theme';
import { AccountsSection } from './accounts';
import { NotificationsSection } from './notifications';
import { TemplatesSection } from './templates';
import { ThemeSection } from './theme';

const SECTIONS = [
  { id: 'accounts', label: 'Tài khoản', view: AccountsSection },
  { id: 'notifications', label: 'Thông báo', view: NotificationsSection },
  { id: 'templates', label: 'Template', view: TemplatesSection },
  { id: 'theme', label: 'Giao diện', view: ThemeSection },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function currentSection(): SectionId {
  const h = location.hash.slice(1);
  return (SECTIONS.find((s) => s.id === h)?.id ?? 'accounts') as SectionId;
}

function App() {
  const [section, setSection] = useState<SectionId>(currentSection());
  useEffect(() => {
    const onHash = () => setSection(currentSection());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const View = SECTIONS.find((s) => s.id === section)?.view ?? AccountsSection;
  return (
    <div class="settings">
      <nav class="settings-nav col">
        <h1>Mail Pulse</h1>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} aria-current={s.id === section ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <main class="settings-main">
        <View />
      </main>
    </div>
  );
}

void initTheme();
render(<App />, document.getElementById('app')!);
