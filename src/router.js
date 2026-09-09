import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import CityView from './views/CityView.vue'
import DayView from './views/DayView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/city/:cityId', name: 'city', component: CityView, props: true },
    { path: '/day/:dayId', name: 'day', component: DayView, props: true },
  ],
})

export default router
