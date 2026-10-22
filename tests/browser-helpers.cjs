// Browser visibility includes closed native details; rectangle sizes alone do not.
function visibleButtonSizes() {
  return [...document.querySelectorAll('button')]
    .filter(button => button.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))
    .map(button => ({id:button.id,w:button.getBoundingClientRect().width,h:button.getBoundingClientRect().height}));
}
module.exports={visibleButtonSizes};
