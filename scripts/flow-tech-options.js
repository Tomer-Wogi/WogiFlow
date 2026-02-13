#!/usr/bin/env node

/**
 * Centralized Tech Stack Options for Wogi Flow
 * Contains all technology definitions with Context7 IDs and ecosystem relationships
 */

// ============================================
// PLATFORM TYPES
// ============================================

const PLATFORM_TYPES = [
  { key: 'a', value: 'web', label: 'Web Application' },
  { key: 'b', value: 'mobile', label: 'Mobile App (React Native / Flutter / Native)' },
  { key: 'c', value: 'desktop', label: 'Desktop App (Electron / Tauri)' },
  { key: 'd', value: 'backend', label: 'Backend API / Microservice' },
  { key: 'e', value: 'fullstack', label: 'Full-Stack (Web + API)' },
  { key: 'f', value: 'cli', label: 'CLI Tool' },
  { key: 'g', value: 'library', label: 'Library / Package' }
];

const FOCUS_AREAS = [
  { key: 'a', value: 'frontend', label: 'Frontend only' },
  { key: 'b', value: 'backend', label: 'Backend only' },
  { key: 'c', value: 'both', label: 'Full-stack (both)' }
];

// ============================================
// FRONTEND FRAMEWORKS
// ============================================

const FRONTEND_FRAMEWORKS = [
  // React Ecosystem
  { key: '1', value: 'react', label: 'React', context7: '/facebook/react', skillsShId: 'vercel-labs/agent-skills/react-best-practices', group: 'React Ecosystem', ecosystem: 'react' },
  { key: '2', value: 'nextjs', label: 'Next.js', context7: '/vercel/next.js', skillsShId: 'vercel-labs/next-skills/next-best-practices', group: 'React Ecosystem', ecosystem: 'react', recommended: true },
  { key: '3', value: 'remix', label: 'Remix', context7: '/remix-run/remix', group: 'React Ecosystem', ecosystem: 'react' },
  { key: '4', value: 'gatsby', label: 'Gatsby', context7: '/gatsbyjs/gatsby', group: 'React Ecosystem', ecosystem: 'react' },

  // Vue Ecosystem
  { key: '5', value: 'vue', label: 'Vue 3', context7: '/vuejs/vue', skillsShId: 'vuejs-ai/skills', group: 'Vue Ecosystem', ecosystem: 'vue' },
  { key: '6', value: 'nuxt', label: 'Nuxt 3', context7: '/nuxt/nuxt', group: 'Vue Ecosystem', ecosystem: 'vue' },

  // Other Frameworks
  { key: '7', value: 'svelte', label: 'Svelte / SvelteKit', context7: '/sveltejs/svelte', group: 'Other Frameworks', ecosystem: 'svelte' },
  { key: '8', value: 'angular', label: 'Angular', context7: '/angular/angular', group: 'Other Frameworks', ecosystem: 'angular' },
  { key: '9', value: 'astro', label: 'Astro', context7: '/withastro/astro', group: 'Other Frameworks', ecosystem: 'astro' },
  { key: '10', value: 'solid', label: 'Solid.js', context7: '/solidjs/solid', group: 'Other Frameworks', ecosystem: 'solid' },
  { key: '11', value: 'qwik', label: 'Qwik', context7: '/qwikdev/qwik', group: 'Other Frameworks', ecosystem: 'qwik' },

  { key: '0', value: 'none', label: 'None / Other', context7: null, group: null, ecosystem: null }
];

// ============================================
// BACKEND FRAMEWORKS
// ============================================

const BACKEND_FRAMEWORKS = [
  // Node.js
  { key: '1', value: 'express', label: 'Express', context7: '/expressjs/express', group: 'Node.js', ecosystem: 'node' },
  { key: '2', value: 'nestjs', label: 'NestJS', context7: '/nestjs/nest', skillsShId: 'kadajett/agent-nestjs-skills/nestjs-best-practices', group: 'Node.js', ecosystem: 'nestjs', recommended: true },
  { key: '3', value: 'fastify', label: 'Fastify', context7: '/fastify/fastify', group: 'Node.js', ecosystem: 'node' },
  { key: '4', value: 'hono', label: 'Hono', context7: '/honojs/hono', group: 'Node.js', ecosystem: 'node' },
  { key: '5', value: 'trpc', label: 'tRPC', context7: '/trpc/trpc', group: 'Node.js', ecosystem: 'node' },

  // Python
  { key: '6', value: 'fastapi', label: 'FastAPI', context7: '/tiangolo/fastapi', group: 'Python', ecosystem: 'python' },
  { key: '7', value: 'django', label: 'Django', context7: '/django/django', group: 'Python', ecosystem: 'python' },
  { key: '8', value: 'flask', label: 'Flask', context7: '/pallets/flask', group: 'Python', ecosystem: 'python' },

  // Other
  { key: '9', value: 'go', label: 'Go (Gin/Echo/Fiber)', context7: '/gin-gonic/gin', group: 'Other', ecosystem: 'go' },
  { key: '10', value: 'rust', label: 'Rust (Actix/Axum)', context7: '/tokio-rs/axum', group: 'Other', ecosystem: 'rust' },
  { key: '11', value: 'spring', label: 'Java (Spring Boot)', context7: '/spring-projects/spring-boot', group: 'Other', ecosystem: 'java' },
  { key: '12', value: 'dotnet', label: '.NET (ASP.NET Core)', context7: '/dotnet/aspnetcore', group: 'Other', ecosystem: 'dotnet' },
  { key: '13', value: 'rails', label: 'Ruby on Rails', context7: '/rails/rails', group: 'Other', ecosystem: 'ruby' },
  { key: '14', value: 'phoenix', label: 'Elixir (Phoenix)', context7: '/phoenixframework/phoenix', group: 'Other', ecosystem: 'elixir' },

  { key: '0', value: 'none', label: 'None / Other', context7: null, group: null, ecosystem: null }
];

// ============================================
// MOBILE FRAMEWORKS
// ============================================

const MOBILE_FRAMEWORKS = [
  { key: '1', value: 'react-native', label: 'React Native', context7: '/facebook/react-native', skillsShId: 'vercel-labs/agent-skills/react-native-guidelines', ecosystem: 'react' },
  { key: '2', value: 'expo', label: 'Expo', context7: '/expo/expo', ecosystem: 'react', recommended: true },
  { key: '3', value: 'flutter', label: 'Flutter', context7: '/flutter/flutter', ecosystem: 'flutter' },
  { key: '4', value: 'swift', label: 'Swift (iOS native)', context7: '/apple/swift', ecosystem: 'ios' },
  { key: '5', value: 'kotlin', label: 'Kotlin (Android native)', context7: '/JetBrains/kotlin', ecosystem: 'android' },
  { key: '0', value: 'none', label: 'None / Other', context7: null, ecosystem: null }
];

// ============================================
// STATE MANAGEMENT
// ============================================

const STATE_MANAGEMENT = [
  // React
  { key: '1', value: 'context', label: 'React Context + useReducer', context7: null, group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '2', value: 'zustand', label: 'Zustand', context7: '/pmndrs/zustand', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'], recommended: true },
  { key: '3', value: 'redux', label: 'Redux Toolkit', context7: '/reduxjs/redux-toolkit', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '4', value: 'jotai', label: 'Jotai', context7: '/pmndrs/jotai', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '5', value: 'recoil', label: 'Recoil', context7: '/facebookexperimental/recoil', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '6', value: 'mobx', label: 'MobX', context7: '/mobxjs/mobx', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '7', value: 'tanstack-query', label: 'TanStack Query (server state)', context7: '/tanstack/query', group: 'React', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },

  // Vue
  { key: '8', value: 'pinia', label: 'Pinia', context7: '/vuejs/pinia', group: 'Vue', forFramework: ['vue', 'nuxt'], recommended: true },
  { key: '9', value: 'vuex', label: 'Vuex', context7: '/vuejs/vuex', group: 'Vue', forFramework: ['vue', 'nuxt'] },

  // General
  { key: '10', value: 'xstate', label: 'XState (state machines)', context7: '/statelyai/xstate', group: 'General', forFramework: null },
  { key: '0', value: 'none', label: 'None / Custom', context7: null, group: 'General', forFramework: null }
];

// ============================================
// FORM LIBRARIES
// ============================================

const FORM_LIBRARIES = [
  { key: '1', value: 'react-hook-form', label: 'React Hook Form', context7: '/react-hook-form/react-hook-form', forFramework: ['react', 'nextjs', 'remix', 'gatsby'], recommended: true },
  { key: '2', value: 'formik', label: 'Formik', context7: '/jaredpalmer/formik', forFramework: ['react', 'nextjs', 'remix', 'gatsby'] },
  { key: '3', value: 'vee-validate', label: 'VeeValidate', context7: '/logaretm/vee-validate', forFramework: ['vue', 'nuxt'] },
  { key: '4', value: 'formkit', label: 'FormKit', context7: '/formkit/formkit', forFramework: ['vue', 'nuxt'] },
  { key: '0', value: 'native', label: 'Native controlled components', context7: null, forFramework: null }
];

// ============================================
// STYLING OPTIONS
// ============================================

const STYLING_OPTIONS = [
  { key: '1', value: 'tailwind', label: 'Tailwind CSS', context7: '/tailwindlabs/tailwindcss', recommended: true },
  { key: '2', value: 'shadcn', label: 'shadcn/ui + Tailwind', context7: '/shadcn-ui/ui', forFramework: ['react', 'nextjs'] },
  { key: '3', value: 'css-modules', label: 'CSS Modules', context7: null },
  { key: '4', value: 'styled-components', label: 'Styled Components', context7: '/styled-components/styled-components', forFramework: ['react', 'nextjs'] },
  { key: '5', value: 'emotion', label: 'Emotion', context7: '/emotion-js/emotion', forFramework: ['react', 'nextjs'] },
  { key: '6', value: 'vanilla-extract', label: 'Vanilla Extract', context7: '/vanilla-extract-css/vanilla-extract' },
  { key: '7', value: 'sass', label: 'Sass/SCSS', context7: '/sass/sass' },
  { key: '8', value: 'css', label: 'Plain CSS', context7: null }
];

// ============================================
// DATA FETCHING
// ============================================

const DATA_FETCHING = [
  { key: '1', value: 'tanstack-query', label: 'TanStack Query', context7: '/tanstack/query', forFramework: ['react', 'nextjs', 'remix', 'vue', 'nuxt'], recommended: true },
  { key: '2', value: 'swr', label: 'SWR', context7: '/vercel/swr', forFramework: ['react', 'nextjs'] },
  { key: '3', value: 'rtk-query', label: 'RTK Query', context7: '/reduxjs/redux-toolkit', forFramework: ['react', 'nextjs'] },
  { key: '4', value: 'apollo', label: 'Apollo Client (GraphQL)', context7: '/apollographql/apollo-client', forFramework: ['react', 'nextjs', 'vue', 'nuxt'] },
  { key: '0', value: 'native', label: 'Native fetch/axios', context7: null, forFramework: null }
];

// ============================================
// ANIMATION LIBRARIES
// ============================================

const ANIMATION_LIBRARIES = [
  { key: '1', value: 'framer-motion', label: 'Framer Motion', context7: '/framer/motion', forFramework: ['react', 'nextjs'], recommended: true },
  { key: '2', value: 'react-spring', label: 'React Spring', context7: '/pmndrs/react-spring', forFramework: ['react', 'nextjs'] },
  { key: '3', value: 'gsap', label: 'GSAP', context7: '/greensock/GSAP', forFramework: null },
  { key: '4', value: 'auto-animate', label: 'AutoAnimate', context7: '/formkit/auto-animate', forFramework: null },
  { key: '0', value: 'none', label: 'None', context7: null, forFramework: null }
];

// ============================================
// VALIDATION LIBRARIES
// ============================================

const VALIDATION_LIBRARIES = [
  { key: '1', value: 'zod', label: 'Zod', context7: '/colinhacks/zod', recommended: true },
  { key: '2', value: 'yup', label: 'Yup', context7: '/jquense/yup' },
  { key: '3', value: 'class-validator', label: 'class-validator', context7: '/typestack/class-validator', forFramework: ['nestjs'] },
  { key: '4', value: 'joi', label: 'Joi', context7: '/hapijs/joi' },
  { key: '5', value: 'valibot', label: 'Valibot', context7: '/fabian-hiller/valibot' },
  { key: '0', value: 'none', label: 'None / Custom', context7: null }
];

// ============================================
// DATABASE / ORM
// ============================================

const DATABASE_OPTIONS = [
  // SQL Databases
  { key: '1', value: 'postgresql', label: 'PostgreSQL', context7: '/postgres/postgres', group: 'SQL', recommended: true },
  { key: '2', value: 'mysql', label: 'MySQL', context7: '/mysql/mysql-server', group: 'SQL' },
  { key: '3', value: 'sqlite', label: 'SQLite', context7: '/sqlite/sqlite', group: 'SQL' },

  // NoSQL Databases
  { key: '4', value: 'mongodb', label: 'MongoDB', context7: '/mongodb/mongo', group: 'NoSQL' },
  { key: '5', value: 'redis', label: 'Redis', context7: '/redis/redis', group: 'NoSQL' },
  { key: '6', value: 'dynamodb', label: 'DynamoDB', context7: '/aws/aws-sdk', group: 'NoSQL' },

  { key: '0', value: 'none', label: 'None', context7: null, group: null }
];

const ORM_OPTIONS = [
  { key: '1', value: 'prisma', label: 'Prisma', context7: '/prisma/prisma', forFramework: ['nextjs', 'nestjs', 'express', 'fastify'] },
  { key: '2', value: 'drizzle', label: 'Drizzle', context7: '/drizzle-team/drizzle-orm', forFramework: ['nextjs', 'nestjs', 'express', 'fastify'] },
  { key: '3', value: 'typeorm', label: 'TypeORM', context7: '/typeorm/typeorm', forFramework: ['nestjs'], recommended: true },
  { key: '4', value: 'mikro-orm', label: 'MikroORM', context7: '/mikro-orm/mikro-orm', forFramework: ['nestjs'] },
  { key: '5', value: 'mongoose', label: 'Mongoose', context7: '/automattic/mongoose', forFramework: ['express', 'nestjs', 'fastify'] },
  { key: '6', value: 'sequelize', label: 'Sequelize', context7: '/sequelize/sequelize', forFramework: ['express', 'nestjs'] },
  { key: '7', value: 'sqlalchemy', label: 'SQLAlchemy', context7: '/sqlalchemy/sqlalchemy', forFramework: ['fastapi', 'flask'] },
  { key: '8', value: 'django-orm', label: 'Django ORM', context7: '/django/django', forFramework: ['django'] },
  { key: '0', value: 'none', label: 'None / Raw SQL', context7: null, forFramework: null }
];

// ============================================
// AUTHENTICATION
// ============================================

const AUTH_OPTIONS = [
  { key: '1', value: 'next-auth', label: 'NextAuth.js / Auth.js', context7: '/nextauthjs/next-auth', forFramework: ['nextjs'] },
  { key: '2', value: 'clerk', label: 'Clerk', context7: '/clerk/javascript', forFramework: ['nextjs', 'react'] },
  { key: '3', value: 'auth0', label: 'Auth0', context7: '/auth0/nextjs-auth0', forFramework: ['nextjs', 'react'] },
  { key: '4', value: 'supabase-auth', label: 'Supabase Auth', context7: '/supabase/supabase', forFramework: ['nextjs', 'react'] },
  { key: '5', value: 'firebase-auth', label: 'Firebase Auth', context7: '/firebase/firebase-js-sdk', forFramework: ['nextjs', 'react'] },
  { key: '6', value: 'passport', label: 'Passport.js', context7: '/jaredhanson/passport', forFramework: ['express', 'nestjs', 'fastify'], recommended: true },
  { key: '7', value: 'lucia', label: 'Lucia', context7: '/lucia-auth/lucia', forFramework: ['nextjs', 'sveltekit'] },
  { key: '0', value: 'custom', label: 'Custom JWT / None', context7: null, forFramework: null }
];

// ============================================
// TESTING
// ============================================

const TESTING_OPTIONS = [
  // Unit Testing
  { key: '1', value: 'vitest', label: 'Vitest', context7: '/vitest-dev/vitest', group: 'Unit', recommended: true },
  { key: '2', value: 'jest', label: 'Jest', context7: '/jestjs/jest', group: 'Unit' },
  { key: '3', value: 'testing-library', label: 'Testing Library', context7: '/testing-library/react-testing-library', group: 'Unit' },

  // E2E Testing
  { key: '4', value: 'playwright', label: 'Playwright', context7: '/microsoft/playwright', group: 'E2E', recommended: true },
  { key: '5', value: 'cypress', label: 'Cypress', context7: '/cypress-io/cypress', group: 'E2E' },

  // Python
  { key: '6', value: 'pytest', label: 'Pytest', context7: '/pytest-dev/pytest', group: 'Python' },

  { key: '0', value: 'none', label: 'None', context7: null, group: null }
];

// ============================================
// ADDITIONAL TOOLS
// ============================================

const ADDITIONAL_TOOLS = [
  { key: '1', value: 'docker', label: 'Docker', context7: '/docker/docs' },
  { key: '2', value: 'kubernetes', label: 'Kubernetes', context7: '/kubernetes/kubernetes' },
  { key: '3', value: 'terraform', label: 'Terraform', context7: '/hashicorp/terraform' },
  { key: '4', value: 'github-actions', label: 'GitHub Actions', context7: '/actions/toolkit' },
  { key: '5', value: 'graphql', label: 'GraphQL', context7: '/graphql/graphql-js' },
  { key: '6', value: 'websockets', label: 'WebSockets', context7: '/websockets/ws' },
  { key: '7', value: 'stripe', label: 'Stripe (Payments)', context7: '/stripe/stripe-node' },
  { key: '8', value: 'sentry', label: 'Sentry (Error Tracking)', context7: '/getsentry/sentry-javascript' },
  { key: '9', value: 'analytics', label: 'Analytics (Posthog/Mixpanel)', context7: '/PostHog/posthog' }
];

// ============================================
// MOBILE-SPECIFIC TOOLS
// ============================================

const MOBILE_TOOLS = [
  { key: '1', value: 'react-navigation', label: 'React Navigation', context7: '/react-navigation/react-navigation', forFramework: ['react-native', 'expo'] },
  { key: '2', value: 'expo-router', label: 'Expo Router', context7: '/expo/router', forFramework: ['expo'] },
  { key: '3', value: 'nativewind', label: 'NativeWind (Tailwind for RN)', context7: '/marklawlor/nativewind', forFramework: ['react-native', 'expo'] },
  { key: '4', value: 'react-native-reanimated', label: 'Reanimated', context7: '/software-mansion/react-native-reanimated', forFramework: ['react-native', 'expo'] },
  { key: '5', value: 'mmkv', label: 'MMKV (Storage)', context7: '/mrousavy/react-native-mmkv', forFramework: ['react-native', 'expo'] }
];

// ============================================
// ECOSYSTEM DEFINITIONS
// ============================================

const ECOSYSTEMS = {
  react: {
    name: 'React Ecosystem',
    categories: ['stateManagement', 'forms', 'styling', 'dataFetching', 'animation', 'validation'],
    defaults: {
      stateManagement: 'zustand',
      forms: 'react-hook-form',
      styling: 'shadcn',
      dataFetching: 'tanstack-query',
      validation: 'zod'
    }
  },
  vue: {
    name: 'Vue Ecosystem',
    categories: ['stateManagement', 'forms', 'styling', 'dataFetching', 'validation'],
    defaults: {
      stateManagement: 'pinia',
      forms: 'vee-validate',
      styling: 'tailwind',
      dataFetching: 'tanstack-query',
      validation: 'zod'
    }
  },
  nestjs: {
    name: 'NestJS Ecosystem',
    categories: ['orm', 'database', 'auth', 'validation'],
    defaults: {
      orm: 'typeorm',
      database: 'postgresql',
      auth: 'passport',
      validation: 'class-validator'
    }
  },
  express: {
    name: 'Express Ecosystem',
    categories: ['orm', 'database', 'auth', 'validation'],
    defaults: {
      orm: 'prisma',
      database: 'postgresql',
      auth: 'passport',
      validation: 'zod'
    }
  },
  python: {
    name: 'Python Ecosystem',
    categories: ['orm', 'database', 'auth'],
    defaults: {
      orm: 'sqlalchemy',
      database: 'postgresql',
      auth: 'custom'
    }
  },
  mobile: {
    name: 'Mobile Ecosystem',
    categories: ['navigation', 'styling', 'animation', 'storage'],
    defaults: {
      navigation: 'expo-router',
      styling: 'nativewind',
      animation: 'react-native-reanimated',
      storage: 'mmkv'
    }
  }
};

// ============================================
// "CHOOSE BEST FOR ME" DEFAULTS
// ============================================

const BEST_DEFAULTS = {
  // Platform defaults
  projectType: 'fullstack',
  focus: 'both',

  // Frontend defaults
  frontend: 'nextjs',
  stateManagement: 'zustand',
  forms: 'react-hook-form',
  styling: 'shadcn',
  dataFetching: 'tanstack-query',
  animation: 'framer-motion',

  // Backend defaults
  backend: 'nestjs',
  orm: 'typeorm',
  database: 'postgresql',
  auth: 'passport',
  validation: 'zod',

  // Testing defaults
  testing: 'vitest',
  e2e: 'playwright',

  // Mobile defaults
  mobile: 'expo',
  mobileNavigation: 'expo-router',
  mobileStyling: 'nativewind'
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get options filtered by framework
 */
function getOptionsForFramework(options, framework) {
  return options.filter(opt => {
    if (!opt.forFramework) return true;
    return opt.forFramework.includes(framework);
  });
}

/**
 * Get ecosystem defaults for a framework
 */
function getEcosystemDefaults(framework) {
  // Map framework to ecosystem
  const frameworkToEcosystem = {
    react: 'react',
    nextjs: 'react',
    remix: 'react',
    gatsby: 'react',
    vue: 'vue',
    nuxt: 'vue',
    nestjs: 'nestjs',
    express: 'express',
    fastify: 'express',
    fastapi: 'python',
    django: 'python',
    flask: 'python',
    'react-native': 'mobile',
    expo: 'mobile'
  };

  const ecosystem = frameworkToEcosystem[framework];
  return ecosystem ? ECOSYSTEMS[ecosystem] : null;
}

/**
 * Get all technologies for Context7 fetching
 */
function collectTechnologiesFromSelections(selections) {
  const technologies = [];
  const allOptions = [
    ...FRONTEND_FRAMEWORKS,
    ...BACKEND_FRAMEWORKS,
    ...MOBILE_FRAMEWORKS,
    ...STATE_MANAGEMENT,
    ...FORM_LIBRARIES,
    ...STYLING_OPTIONS,
    ...DATA_FETCHING,
    ...ANIMATION_LIBRARIES,
    ...VALIDATION_LIBRARIES,
    ...DATABASE_OPTIONS,
    ...ORM_OPTIONS,
    ...AUTH_OPTIONS,
    ...TESTING_OPTIONS,
    ...ADDITIONAL_TOOLS,
    ...MOBILE_TOOLS
  ];

  const selectedValues = Object.values(selections).flat().filter(v => v && v !== 'none' && v !== 'native' && v !== 'custom');

  for (const value of selectedValues) {
    const option = allOptions.find(o => o.value === value);
    if (option && option.context7) {
      technologies.push({
        value: option.value,
        label: option.label,
        context7: option.context7,
        group: option.group || null,
        forFramework: option.forFramework || null
      });
    }
  }

  return technologies;
}

/**
 * Determine skill type (hub/framework vs spoke/library)
 */
function getSkillType(techValue) {
  const frameworks = ['nextjs', 'react', 'vue', 'nuxt', 'svelte', 'angular', 'astro', 'nestjs', 'express', 'fastify', 'fastapi', 'django', 'flask', 'expo', 'react-native', 'flutter'];
  return frameworks.includes(techValue) ? 'framework' : 'library';
}

/**
 * Get parent framework for a library
 */
function getParentFramework(techValue, selections) {
  const frontendEcosystemLibs = ['zustand', 'redux', 'jotai', 'recoil', 'mobx', 'tanstack-query', 'react-hook-form', 'formik', 'framer-motion', 'react-spring', 'swr', 'rtk-query'];
  const vueEcosystemLibs = ['pinia', 'vuex', 'vee-validate', 'formkit'];
  const nestjsEcosystemLibs = ['typeorm', 'mikro-orm', 'class-validator'];

  if (frontendEcosystemLibs.includes(techValue)) {
    return selections.frontend || 'react';
  }
  if (vueEcosystemLibs.includes(techValue)) {
    return selections.frontend || 'vue';
  }
  if (nestjsEcosystemLibs.includes(techValue)) {
    return 'nestjs';
  }

  return null;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Platform & Focus
  PLATFORM_TYPES,
  FOCUS_AREAS,

  // Frameworks
  FRONTEND_FRAMEWORKS,
  BACKEND_FRAMEWORKS,
  MOBILE_FRAMEWORKS,

  // Frontend Ecosystem
  STATE_MANAGEMENT,
  FORM_LIBRARIES,
  STYLING_OPTIONS,
  DATA_FETCHING,
  ANIMATION_LIBRARIES,

  // Backend Ecosystem
  DATABASE_OPTIONS,
  ORM_OPTIONS,
  AUTH_OPTIONS,
  VALIDATION_LIBRARIES,

  // Testing & Tools
  TESTING_OPTIONS,
  ADDITIONAL_TOOLS,
  MOBILE_TOOLS,

  // Ecosystem Definitions
  ECOSYSTEMS,
  BEST_DEFAULTS,

  // Helper Functions
  getOptionsForFramework,
  getEcosystemDefaults,
  collectTechnologiesFromSelections,
  getSkillType,
  getParentFramework
};
