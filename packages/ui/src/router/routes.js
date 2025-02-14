export const routes = [
  {
    path: '/',
    component: () => import('@/layouts/default/DefaultLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/HomeView.vue'),
      },
    ],
  },
  {
    path: '/preview',
    component: () => import('@/layouts/default/DefaultLayout.vue'),
    children: [
      {
        path: '',
        name: 'preview',
        component: () => import('@/views/PreviewView.vue'),
        beforeEnter: (to, from, next) => {
          // const fps = to.query.fps;
          // const bitRate = to.query.bitRate;
          next();
        },
      },
    ],
  },
]
