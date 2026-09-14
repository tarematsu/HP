#pragma once

// sh.h has been parsed by sh_track_boundary_message_policy.h at this point.
// Remove the temporary member-name rewrite before implementation sources use
// autoClickInFlight_ normally.
#undef autoClickInFlight_

// Build the effective document-start script once, at the end of the Stationhead
// setup. The included header lists the runtime pieces in their real execution
// order instead of adding another behavioral wrapper layer.
#include "sh_presentation_registration_policy.h"
