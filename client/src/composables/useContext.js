import { computed } from 'vue'
import { useStore } from 'vuex'

export function useContext() {
  const store = useStore()
  return {
    session: store.state,
    versionOptions: computed(() => store.getters.versionsForJurisdiction),
    currentVersion: computed(() => store.getters.currentVersion),
    setOrg: (id) => store.commit('setOrg', id),
    setJurisdiction: (code) => store.commit('setJurisdiction', code),
    loadBootstrap: () => store.dispatch('loadBootstrap'),
  }
}
