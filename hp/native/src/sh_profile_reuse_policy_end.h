#pragma once

// sh.h has been parsed by sh_track_boundary_message_policy.h at this point.
// Remove the temporary member-name rewrite before implementation sources use
// autoClickInFlight_ normally.
#undef autoClickInFlight_

// This header is the final Stationhead PCH composition boundary. Register the
// presentation-only document-start wrapper here, after the current-interaction
// autoplay policy has been selected, so later autoplay policy overrides cannot
// discard the UI/render reduction layer.
#include "sh_presentation_registration_policy.h"
