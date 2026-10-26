import { createStore } from 'vuex'
import { fetchBootstrap } from '@/api/bootstrap'

function versionsFor(state) {
  return state.versions.filter((item) => item.jurisdiction === state.jurisdiction)
}

function alignOrg(state) {
  const list = state.orgs.filter((item) => item.jurisdiction === state.jurisdiction)
  if (!list.length || list.some((item) => item.id === state.orgId)) return
  state.orgId = list[0].id
}

const store = createStore({
  state() {
    return {
      ready: false,
      error: '',
      customers: [],
      jurisdictions: [],
      versions: [],
      orgs: [],
      customerId: 'c-city',
      orgId: 'mo-branch',
      jurisdiction: 'MO',
      versionId: 'rv-mo-2026-1',
      baseDate: '2026-09-30',
    }
  },
  getters: {
    versionsForJurisdiction(state) {
      return versionsFor(state)
    },
    currentVersion(state) {
      return state.versions.find((item) => item.id === state.versionId) || versionsFor(state)[0] || null
    },
  },
  mutations: {
    setBootstrap(state, data) {
      state.customers = data.customers || []
      state.jurisdictions = data.jurisdictions || []
      state.versions = data.versions || []
      state.orgs = data.orgs || []
      const published = state.versions.find((item) => item.jurisdiction === 'MO' && item.status === 'published')
      if (published) state.versionId = published.id
      alignOrg(state)
      state.ready = true
      state.error = ''
    },
    setError(state, message) {
      state.error = message || ''
    },
    setJurisdiction(state, code) {
      state.jurisdiction = code
      alignOrg(state)
      const list = versionsFor(state)
      const next = list.find((item) => item.status === 'published') || list[0]
      if (next) state.versionId = next.id
    },
    setOrg(state, id) {
      state.orgId = id
      const org = state.orgs.find((item) => item.id === id)
      if (!org) return
      state.jurisdiction = org.jurisdiction
      const list = versionsFor(state)
      const next = list.find((item) => item.status === 'published') || list[0]
      if (next) state.versionId = next.id
    },
  },
  actions: {
    async loadBootstrap({ commit }) {
      try {
        const data = await fetchBootstrap()
        commit('setBootstrap', data)
      } catch (err) {
        commit('setError', err.message || '接口没有连上')
      }
    },
  },
})

export default store
