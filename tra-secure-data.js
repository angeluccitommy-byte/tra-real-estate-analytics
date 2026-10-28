// TRA authenticated metrics reader. Access is enforced by Supabase RLS,
// not by this JavaScript module or the GitHub Pages login screen.
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const supabase=createClient(
  'https://bluavamwhplpyuzep pfc.supabase.co'.replace(' ',''),
  'sb_publishable_P20i7A0SMagYEuD3pvGkrw_LIYb5okv'
);
export async function getAuthenticatedMetrics(){
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)throw new Error('TRA sign-in required');
  const {data,error}=await supabase.from('tra_metrics').select('metric,value');
  if(error)throw new Error('TRA data access denied: '+error.message);
  if(!data?.length)throw new Error('No authorized TRA metrics were returned');
  return Object.fromEntries(data.filter(row=>row.metric).map(row=>[row.metric,row.value??'']));
}
