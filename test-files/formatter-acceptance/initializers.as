class Initializers {
  array<array<int>> grid={{1,2},{3,4}};
  dictionary@ meta=dictionary();
  vec3 position=vec3(1,2,3);

  Initializers() {
    @meta=dictionary();
    array<int> values={1,2,3};
    dictionary local={{"one",1},{"two",2}};
  }
}

void Main() {
  Initializers@ item=Initializers();
}
