import { randomUUID } from 'node:crypto';

export type Priority = 'low' | 'normal' | 'high';

export interface Todo {
  id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  projectId: string;
  done: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Database {
  users: Map<string, User & { password: string }>;
  sessions: Map<string, string>;
  projects: Project[];
  todos: Todo[];
  tags: Tag[];
  events: { name: string; at: string }[];
}

const DEMO_PASSWORD = 'ghost';

function seedProjects(): Project[] {
  return [
    { id: 'prj_inbox', name: 'Inbox', color: '#8b8b8b' },
    { id: 'prj_launch', name: 'Launch', color: '#3b82f6' },
    { id: 'prj_home', name: 'Home', color: '#22c55e' },
  ];
}

function seedTodos(): Todo[] {
  const now = new Date().toISOString();
  const base = [
    { title: 'Draft the launch post', priority: 'high' as Priority, projectId: 'prj_launch' },
    { title: 'Buy milk', priority: 'normal' as Priority, projectId: 'prj_home' },
    { title: 'Fix the navbar bug', priority: 'high' as Priority, projectId: 'prj_launch' },
    { title: 'Water the plants', priority: 'low' as Priority, projectId: 'prj_home' },
  ];
  return base.map((item) => ({
    id: `todo_${randomUUID().slice(0, 8)}`,
    title: item.title,
    notes: null,
    priority: item.priority,
    projectId: item.projectId,
    done: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }));
}

export function createDatabase(): Database {
  const users = new Map<string, User & { password: string }>();
  users.set('demo@ghostapi.dev', {
    id: 'usr_demo',
    email: 'demo@ghostapi.dev',
    name: 'Demo User',
    password: DEMO_PASSWORD,
  });
  return {
    users,
    sessions: new Map(),
    projects: seedProjects(),
    todos: seedTodos(),
    tags: [{ id: 'tag_bug', name: 'bug' }],
    events: [],
  };
}

export const DEMO_CREDENTIALS = { email: 'demo@ghostapi.dev', password: DEMO_PASSWORD };
